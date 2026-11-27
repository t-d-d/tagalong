import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  deployPath,
  gatePath,
  readRepoFile,
  readWorkflow,
  readYaml,
  repoFiles,
  runsIn,
  triggers,
} from "../test/repo.ts";

// Governor sees a deploy only through the shipping job's name, which ends
// " · deployed: <target>", and the workflow's top-level TICKET_LABEL_PATHS.
// This is governor's own pattern for the name, from
// dispatch/webhook/fire.mjs in t-d-d/gh-governor.
const shipping = /(?: at ([0-9a-f]{7,40}))? · (deployed: .+)$/u;

const configPath = ".github/governor.json";

// Just enough of .github/governor.json for the checks to read. A section
// turns its feature on unless it sets "enabled": false.
const section = z.object({ enabled: z.boolean().optional() });
const governorSchema = z.object({
  workflows: z.object({ ci: z.string() }),
  pickup: section.extend({
    ready: z.array(z.string()),
    claim: z.string(),
    claimRemoves: z.array(z.string()).optional(),
  }),
  deployMessages: section.extend({
    tags: z.record(z.string(), z.string()).optional(),
    deployedLabels: z.boolean().optional(),
  }),
  prReview: section.extend({
    waitForCi: z.boolean().optional(),
    requireChecks: z
      .array(
        z.union([z.string(), z.object({ name: z.string(), app: z.string() })]),
      )
      .optional(),
  }),
});

const config = () => governorSchema.parse(JSON.parse(readRepoFile(configPath)));

describe("fitness: governor serves this repo from .github/governor.json (repo-and-delivery.md)", () => {
  it("keeps its settings in governor.json alone, since governor no longer reads dispatch.json", () => {
    expect(repoFiles()).toContain(configPath);
    expect(repoFiles()).not.toContain(".github/dispatch.json");
  });

  // docs/issue-workflow.md: governor starts a mode: afk ticket that is
  // ready for development, and claims it with under development.
  it("picks up and claims tickets by the labels the issue workflow names", () => {
    const { pickup } = config();
    expect(pickup.enabled).not.toBe(false);
    expect(pickup.ready).toEqual([
      "workflow: ready for development",
      "mode: afk",
    ]);
    expect(pickup.claim).toBe("workflow: under development");
    expect(pickup.claimRemoves).toEqual(["workflow: ready for development"]);
  });

  // The CI workflow runs only after a merge, so the review cannot wait for
  // it on a pull request's head. It waits for the gate's check instead
  // (test 8 of the pr-review checklist).
  it("makes the PR review wait for the gate on a pull request's head", () => {
    const { workflows, prReview } = config();
    expect(prReview.enabled).not.toBe(false);
    expect(triggers(readWorkflow(workflows.ci))).not.toContain("pull_request");
    expect(prReview.waitForCi).toBe(false);
    expect(prReview.requireChecks).toContainEqual({
      name: "gate",
      app: "github-actions",
    });
    const gate = readWorkflow(gatePath);
    expect(triggers(gate)).toContain("pull_request");
    expect(gate.jobs.gate?.name).toBe("gate");
  });
});

describe("fitness: governor tells a session when its change is live (docs/issue-workflow.md)", () => {
  const { jobs } = readWorkflow(deployPath);

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
    const { deployMessages } = config();
    expect(deployMessages.enabled).not.toBe(false);
    expect(deployMessages.deployedLabels).toBe(true);
  });

  it("names live-ok, the tag a passed deploy moves, as live's tag", () => {
    expect(config().deployMessages.tags).toEqual({ live: "live-ok" });
    expect(runsIn(jobs["mark-live-ok"]).join("\n")).toContain(
      "refs/tags/live-ok",
    );
  });
});
