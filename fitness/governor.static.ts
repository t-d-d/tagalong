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

// The reusable workflow governor publishes to check a served repo's config
// file with its own reader, and the commit of t-d-d/gh-governor a ref names.
const configCheckPath = ".github/workflows/config-check.yml";
const governorCheck =
  /^t-d-d\/gh-governor\/\.github\/workflows\/config-check\.yml@([0-9a-f]{40})$/u;
const schemaUrl =
  /^https:\/\/raw\.githubusercontent\.com\/t-d-d\/gh-governor\/([0-9a-f]{40})\/schema\/governor\.schema\.json$/u;

// Just enough of the config check workflow for the checks to read. The
// shared workflow schema leaves out a job's `with`.
const configCheckSchema = z.object({
  on: z.object({
    pull_request: z.object({ paths: z.array(z.string()) }),
  }),
  permissions: z.record(z.string(), z.string()),
  jobs: z.record(
    z.string(),
    z.object({
      uses: z.string().optional(),
      with: z.record(z.string(), z.unknown()).optional(),
      secrets: z.unknown().optional(),
    }),
  ),
});

// Every prompt file governor.json names, as { "file": "<path>" }.
const promptFiles = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(promptFiles);
  if (typeof value !== "object" || value === null) return [];
  const { file } = value as { file?: unknown };
  return [
    ...(typeof file === "string" ? [file] : []),
    ...Object.values(value).flatMap(promptFiles),
  ];
};

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

describe("fitness: governor's own check reads .github/governor.json on each pull request (repo-and-delivery.md)", () => {
  const workflow = () => readYaml(configCheckPath, configCheckSchema);
  const checkJob = () => Object.values(workflow().jobs)[0];

  it("calls governor's config check, pinned by commit, with no secret", () => {
    expect(Object.keys(workflow().jobs)).toHaveLength(1);
    const job = checkJob();
    expect(job?.uses).toMatch(governorCheck);
    expect(job?.secrets).toBeUndefined();
    expect(workflow().permissions).toEqual({ contents: "read" });
  });

  // A called workflow cannot learn its own commit, so it takes it again.
  it("passes the commit it is pinned to as the check's commit", () => {
    const job = checkJob();
    const pinned = governorCheck.exec(job?.uses ?? "")?.[1];
    expect(pinned).toBeDefined();
    expect(job?.with).toStrictEqual({ commit: pinned });
  });

  it("names the same commit in governor.json's $schema, so the editor and the check read one schema", () => {
    const { $schema } = z
      .object({ $schema: z.string() })
      .parse(JSON.parse(readRepoFile(configPath)));
    const pinned = governorCheck.exec(checkJob()?.uses ?? "")?.[1];
    expect(pinned).toBeDefined();
    expect(schemaUrl.exec($schema)?.[1]).toBe(pinned);
  });

  // The check reads the config, the prompt files it names, the CI workflow
  // it names, the issue templates in the folder and in the three places
  // GitHub reads a single template, and CLAUDE.md, so a change to any of
  // them runs it. A change to this workflow runs it too.
  it("runs on a pull request that changes any file the check reads", () => {
    const paths = workflow().on.pull_request.paths;
    const prompts = promptFiles(JSON.parse(readRepoFile(configPath)));
    expect(prompts).toContain(".claude/skills/pr-review/SKILL.md");
    for (const path of [
      configPath,
      configCheckPath,
      config().workflows.ci,
      "CLAUDE.md",
      ".github/ISSUE_TEMPLATE/**",
      "ISSUE_TEMPLATE.md",
      ".github/ISSUE_TEMPLATE.md",
      "docs/ISSUE_TEMPLATE.md",
      ...prompts,
    ])
      expect(paths).toContain(path);
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
