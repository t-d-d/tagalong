import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { eventsOf, logLines } from "../../test/log-lines.ts";
import { type Payload, WEBHOOK_PATH, webhookServer } from "./webhook.ts";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function listen(onPayload: (payload: Payload) => void) {
  const server = webhookServer(() => "the-token", onPayload);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port =
    typeof address === "object" && address !== null
      ? (address satisfies AddressInfo).port
      : 0;
  close = () =>
    new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  const post = (body: string, token = "the-token") =>
    fetch(`http://127.0.0.1:${String(port)}${WEBHOOK_PATH}`, {
      method: "POST",
      headers: { "X-Bridge-Token": token },
      body,
    });
  return { port, post };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("the webhook", () => {
  it("takes a payload carrying the bridge's token", async () => {
    const got: Payload[] = [];
    const { post } = await listen((payload) => got.push(payload));
    const response = await post(
      JSON.stringify({
        chatJID: "120363000000000001@g.us",
        content: "hi",
        messageId: "m1",
      }),
    );
    expect(response.status).toBe(200);
    await settle();
    expect(got).toEqual([
      expect.objectContaining({
        chatJID: "120363000000000001@g.us",
        content: "hi",
        messageId: "m1",
        isFromMe: false,
      }),
    ]);
  });

  it("refuses any other token, unread", async () => {
    const { lines } = logLines();
    const got: Payload[] = [];
    const { post } = await listen((payload) => got.push(payload));
    expect((await post("{}", "wrong-token")).status).toBe(401);
    expect((await post("{}", "")).status).toBe(401);
    expect(got).toEqual([]);
    expect(eventsOf(lines)).toEqual(["webhook-rejected", "webhook-rejected"]);
  });

  it("logs what it cannot read, and survives a handler that throws", async () => {
    const { lines } = logLines();
    const { post, port } = await listen(() => {
      throw new Error("boom");
    });
    expect((await post("not json")).status).toBe(200);
    expect((await post(JSON.stringify({ no: "chat" }))).status).toBe(200);
    expect(
      (await post(JSON.stringify({ chatJID: "120363000000000001@g.us" })))
        .status,
    ).toBe(200);
    await settle();
    expect(eventsOf(lines)).toEqual([
      "webhook-unreadable",
      "webhook-unreadable",
      "payload-failed",
    ]);
    expect(lines.at(-1)?.level).toBe("error");
    expect(
      await (await fetch(`http://127.0.0.1:${String(port)}/healthz`)).text(),
    ).toBe("ok");
    expect((await fetch(`http://127.0.0.1:${String(port)}/other`)).status).toBe(
      404,
    );
  });
});
