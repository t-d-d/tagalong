import { describe, expect, it } from "vitest";
import { fakeAws } from "../../test/fake-aws.ts";
import { eventsOf, logLines } from "../../test/log-lines.ts";
import { answer } from "./upload-link.ts";

const NOW = Date.UTC(2026, 9, 31, 12);
const ID = "Zk3q9xT0aB4mN7pR2sV5wY8c";

/** The event API Gateway's HTTP API gives the Lambda for GET /up/{id}/{name}. */
const event = (id: string, name: string) => ({
  version: "2.0",
  routeKey: "GET /up/{id}/{name}",
  rawPath: `/up/${id}/${name}`,
  pathParameters: { id, name },
});

/** A bucket whose link marker was written `ago` ms before NOW, or none. */
function bucket(ago?: number) {
  const aws = fakeAws(() => NOW);
  if (ago !== undefined)
    aws.objects.set(`files/links/${ID}`, {
      body: Buffer.alloc(0),
      contentType: "application/octet-stream",
      at: NOW - ago,
    });
  return aws;
}

const deps = (aws: ReturnType<typeof fakeAws>) => ({
  aws,
  bucket: "files",
  now: () => NOW,
});

describe("the upload link (attachments.md)", () => {
  it("answers a working link with a five-minute URL to put one file in its session's folder", async () => {
    const { lines } = logLines();
    const aws = bucket(60_000);
    const reply = await answer(event(ID, "chart.png"), deps(aws));
    expect(reply).toEqual({
      statusCode: 200,
      headers: { "content-type": "text/plain" },
      body: `https://files.s3.example.test/outgoing/${ID}/chart.png?put=300`,
    });
    expect(eventsOf(lines)).toEqual(["link-signed"]);
  });

  it("makes the file's name safe, so it stays in the folder", async () => {
    const aws = bucket(60_000);
    const reply = await answer(event(ID, "../my chart.png"), deps(aws));
    expect(reply.body).toBe(
      `https://files.s3.example.test/outgoing/${ID}/_my_chart.png?put=300`,
    );
  });

  it("works until two hours after the session's latest delivery", async () => {
    const aws = bucket(2 * 3_600_000 - 1000);
    expect((await answer(event(ID, "a.png"), deps(aws))).statusCode).toBe(200);
  });

  it("refuses a link whose session has had no delivery for two hours, and signs nothing", async () => {
    const { lines, raw } = logLines();
    const aws = bucket(2 * 3_600_000 + 1000);
    const reply = await answer(event(ID, "a.png"), deps(aws));
    expect(reply.statusCode).toBe(404);
    expect(reply.body).not.toContain("http");
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: "info",
        event: "link-refused",
        why: "lapsed",
      }),
    );
    // Neither the link nor the file's name reaches a line (logging.md).
    expect(
      raw.filter((line) => line.includes(ID) || line.includes("a.png")),
    ).toEqual([]);
  });

  it("refuses a link tagalong never made", async () => {
    const { lines } = logLines();
    const reply = await answer(event(ID, "a.png"), deps(bucket()));
    expect(reply.statusCode).toBe(404);
    expect(lines).toContainEqual(
      expect.objectContaining({ event: "link-refused", why: "unknown" }),
    );
  });

  it("refuses a malformed link without asking S3", async () => {
    const { lines } = logLines();
    const aws = bucket(60_000);
    aws.modifiedAt = () => Promise.reject(new Error("asked S3"));
    for (const bad of [
      event("short", "a.png"),
      event(`${ID}x`, "a.png"),
      event("Zk3q9xT0aB4mN7pR2sV5wY8/", "a.png"),
      event(ID, ""),
      { version: "2.0", rawPath: "/" },
      "not an event",
    ]) {
      const reply = await answer(bad, deps(aws));
      expect(reply.statusCode).toBe(404);
    }
    expect(eventsOf(lines).every((name) => name === "link-refused")).toBe(true);
  });

  it("says so, and logs it, when it cannot sign", async () => {
    const { lines } = logLines();
    const aws = bucket(60_000);
    aws.presignPut = () =>
      Promise.reject(
        Object.assign(new Error("no credentials"), {
          name: "CredentialsProviderError",
        }),
      );
    const reply = await answer(event(ID, "a.png"), deps(aws));
    expect(reply.statusCode).toBe(502);
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: "warn",
        event: "link-failed",
        error: "CredentialsProviderError",
      }),
    );
  });

  it("says S3 failed, and signs nothing, when it cannot read the marker", async () => {
    const { lines } = logLines();
    const aws = bucket(60_000);
    aws.modifiedAt = () =>
      Promise.reject(
        Object.assign(new Error("slow"), { name: "TimeoutError" }),
      );
    const reply = await answer(event(ID, "a.png"), deps(aws));
    expect(reply.statusCode).toBe(502);
    expect(lines).toContainEqual(
      expect.objectContaining({ level: "warn", event: "link-failed" }),
    );
  });
});
