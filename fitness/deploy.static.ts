import { describe, expect, it } from "vitest";
import {
  deployPath,
  readRepoFile,
  readWorkflow,
  runsIn,
} from "../test/repo.ts";

describe("fitness: a failed deploy says why (repo-and-delivery.md)", () => {
  const script = readRepoFile("scripts/deploy.sh");

  it("prints CloudFormation's reason for each resource that failed", () => {
    expect(script).toMatch(/describe-stack-events[\s\S]*_FAILED/u);
    expect(script).toContain("GITHUB_STEP_SUMMARY");
  });

  it("clears a stack whose first create rolled back, which CloudFormation cannot update", () => {
    expect(script).toMatch(
      /ROLLBACK_COMPLETE[\s\S]*delete-stack[\s\S]*wait stack-delete-complete/u,
    );
  });

  it("makes ECS's service-linked role in a new account, which the cluster needs", () => {
    expect(script).toMatch(
      /create-service-linked-role --aws-service-name ecs\.amazonaws\.com/u,
    );
  });
});

// GitHub re-runs a job's dependents with it, and keeps the result of a job
// it does not re-run. So mark-live-ok runs again only beside a deploy job
// that ran again, and that job deploys the run's own commit.
describe("fitness: live-ok follows the commit that passed its live check (repo-and-delivery.md)", () => {
  const { jobs } = readWorkflow(deployPath);
  const deploy = jobs.deploy;
  const mark = jobs["mark-live-ok"];

  it("moves live-ok on any attempt whose deploy passed, not only the first", () => {
    expect(mark?.if).toBeDefined();
    expect(mark?.if).not.toMatch(/run_attempt/u);
    expect(mark?.if).toMatch(/success\(\)/u);
    expect(mark?.needs).toBe("deploy");
  });

  it("deploys the run's own commit, which is the one live-ok is moved to", () => {
    const checkout = deploy?.steps?.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkout).toBeDefined();
    expect(checkout?.with?.ref).toBeUndefined();
    expect(runsIn(mark).join("\n")).toContain('sha="$GITHUB_SHA"');
  });

  it("checks the heartbeat in the deploy job, so its success means the live check passed", () => {
    expect(runsIn(deploy).at(-1)).toBe("scripts/deploy.sh live");
  });

  it("leaves live-ok alone when only the rollback runs", () => {
    expect(mark?.needs).not.toContain("rollback");
    expect(runsIn(jobs.rollback).join("\n")).not.toMatch(/live-ok/u);
  });
});
