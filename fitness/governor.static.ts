import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  deployPath,
  readRepoFile,
  readWorkflow,
  readYaml,
  runsIn,
} from "../test/repo.ts";

// Governor sees a deploy only through the shipping job's name, which ends
// " · deployed: <target>", and the workflow's top-level TICKET_LABEL_PATHS.
// This is governor's own pattern for the name, from
// dispatch/webhook/fire.mjs in t-d-d/gh-governor.
const shipping = /(?: at ([0-9a-f]{7,40}))? · (deployed: .+)$/u;

// Just enough of .github/dispatch.json for the checks to read.
const dispatchSchema = z.object({
  features: z.record(z.string(), z.boolean()),
  workflows: z
    .object({ tags: z.record(z.string(), z.string()).optional() })
    .optional(),
});

describe("fitness: governor tells a session when its change is live (docs/issue-workflow.md)", () => {
  const { jobs } = readWorkflow(deployPath);
  const config = dispatchSchema.parse(
    JSON.parse(readRepoFile(".github/dispatch.json")),
  );

  // The rollback puts back an older build, so a marker there would tell a
  // session its change is live when it has just been taken down.
  it("marks the deploy job, and no other, as the one that ships to live", () => {
    const marked = Object.entries(jobs).flatMap(([id, job]) => {
      const label = shipping.exec(job.name ?? "")?.[2];
      return label === undefined ? [] : [{ id, label }];
    });
    expect(marked).toEqual([{ id: "deploy", label: "deployed: live" }]);
  });

  it("labels every ticket a deploy shipped, since each merge deploys everything", () => {
    const { env } = readYaml(
      deployPath,
      z.object({ env: z.record(z.string(), z.unknown()).optional() }),
    );
    expect(env?.TICKET_LABEL_PATHS).toBe("all");
  });

  it("turns on governor's deploy messages and labels", () => {
    expect(config.features.deployMessages).toBe(true);
    expect(config.features.deployedLabels).toBe(true);
  });

  it("names live-ok, the tag a passed deploy moves, as live's tag", () => {
    expect(config.workflows?.tags).toEqual({ live: "live-ok" });
    expect(runsIn(jobs["mark-live-ok"]).join("\n")).toContain(
      "refs/tags/live-ok",
    );
  });
});
