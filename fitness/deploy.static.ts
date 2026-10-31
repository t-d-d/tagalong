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

// A re-run can repeat any set of jobs, and a job it does not repeat keeps its
// last result. So live-ok moves only in an attempt whose own deploy job
// deployed this run's commit and passed its live check.
describe("fitness: live-ok follows the commit that passed its live check (repo-and-delivery.md)", () => {
  const { jobs } = readWorkflow(deployPath);
  const deploy = jobs.deploy;
  const mark = jobs["mark-live-ok"];
  const steps = deploy?.steps ?? [];
  const passed = steps.at(-1);

  it("records the attempt that passed, as the deploy job's last step", () => {
    expect(passed?.id).toBe("passed");
    expect(passed?.if).toBeUndefined();
    expect(passed?.run).toBe(
      'echo "attempt=$GITHUB_RUN_ATTEMPT" >> "$GITHUB_OUTPUT"',
    );
    expect(deploy?.outputs?.["passed-attempt"]).toBe(
      "${{ steps.passed.outputs.attempt }}",
    );
  });

  it("moves live-ok on any attempt whose own deploy passed, and no other", () => {
    expect(mark?.needs).toBe("deploy");
    expect(mark?.if).toBe(
      "${{ success() && needs.deploy.outputs.passed-attempt == github.run_attempt }}",
    );
  });

  it("deploys the run's own commit, which is the one live-ok is moved to", () => {
    const checkout = steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkout).toBeDefined();
    expect(checkout?.with?.ref).toBeUndefined();
    expect(runsIn(mark).join("\n")).toContain('sha="$GITHUB_SHA"');
  });

  it("records the attempt only after the heartbeat, with nothing allowed to fail", () => {
    const live = steps.at(-2);
    expect(live?.run).toBe("scripts/deploy.sh live");
    expect(live?.if).toBeUndefined();
    expect(deploy?.["continue-on-error"]).toBeUndefined();
    for (const step of steps) {
      expect(
        step["continue-on-error"],
        step.name ?? step.uses ?? step.run,
      ).toBeUndefined();
    }
  });

  it("leaves live-ok alone when only the rollback runs", () => {
    expect(runsIn(jobs.rollback).join("\n")).not.toMatch(/live-ok/u);
  });
});
