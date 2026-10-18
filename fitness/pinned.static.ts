import { describe, expect, it } from "vitest";
import { readRepoFile, readWorkflow, workflowPaths } from "../test/repo.ts";

const dockerfiles = ["images/bridge.Dockerfile", "images/tagalong.Dockerfile"];

describe("fitness: everything a build fetches is pinned (repo-and-delivery.md)", () => {
  it("names every base image by digest", () => {
    for (const path of dockerfiles) {
      const froms = [...readRepoFile(path).matchAll(/^FROM (\S+)/gmu)].map(
        (match) => match[1] ?? "",
      );
      expect(froms.length, path).toBeGreaterThan(0);
      for (const image of froms)
        expect(image, path).toMatch(
          /^public\.ecr\.aws\/[^@\s]+@sha256:[0-9a-f]{64}$/u,
        );
    }
  });

  it("builds the bridge from one commit, and checks it got that commit", () => {
    const text = readRepoFile("images/bridge.Dockerfile");
    expect(text).toMatch(/^ARG BRIDGE_COMMIT=[0-9a-f]{40}$/mu);
    expect(text).toContain(
      'test "$(git -C /src rev-parse HEAD)" = "$BRIDGE_COMMIT"',
    );
  });

  it("installs one version of the Claude Code CLI, which never updates itself (cloud-sessions.md)", () => {
    const text = readRepoFile("images/tagalong.Dockerfile");
    expect(text).toMatch(
      /npm install -g @anthropic-ai\/claude-code@\d+\.\d+\.\d+\n/u,
    );
    expect(text).toMatch(/DISABLE_AUTOUPDATER=1/u);
  });

  it("names every action by commit", () => {
    for (const path of workflowPaths()) {
      for (const job of Object.values(readWorkflow(path).jobs)) {
        for (const step of job.steps ?? []) {
          if (step.uses !== undefined)
            expect(step.uses, path).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u);
        }
      }
    }
  });
});

describe("fitness: only main deploys (repo-and-delivery.md)", () => {
  it("deploys on a push to main, after the gate", () => {
    const deploy = readWorkflow(".github/workflows/deploy.yml");
    expect(deploy.on).toEqual({ push: { branches: ["main"] } });
    expect(deploy.jobs.deploy?.needs).toBe("gate");
    expect(deploy.jobs.gate?.uses).toBe("./.github/workflows/gate.yml");
  });

  it("runs the gate with the one command", () => {
    const steps =
      readWorkflow(".github/workflows/gate.yml").jobs.gate?.steps ?? [];
    expect(
      steps.map((step) => step.run).filter((run) => run !== undefined),
    ).toEqual(["npm ci --ignore-scripts", "npm run gate"]);
  });

  it("names no GitHub environment on a job that assumes the role", () => {
    const deploy = readWorkflow(".github/workflows/deploy.yml");
    for (const job of Object.values(deploy.jobs)) {
      if (
        typeof job.permissions === "object" &&
        job.permissions["id-token"] === "write"
      )
        expect(job.environment).toBeUndefined();
    }
  });
});
