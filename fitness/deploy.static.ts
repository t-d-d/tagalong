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

  it("keeps set -e inside command substitutions, so a failed image build stops the deploy (#32)", () => {
    expect(script).toMatch(
      /^set -euo pipefail\n(?:#.*\n)*shopt -s inherit_errexit$/mu,
    );
  });

  it("says which image failed to build or push, in the log and the run's summary", () => {
    expect(script).toMatch(
      /docker build [^\n]*\|\| \{ echo "[^"]*\$repo:\$tag[^"]*" \| tee -a "\$summary" >&2; return 1; \}/u,
    );
    expect(script).toMatch(
      /docker push [^\n]*\|\| \{ echo "[^"]*\$repo:\$tag[^"]*" \| tee -a "\$summary" >&2; return 1; \}/u,
    );
  });

  // The image() function, from its name to its closing brace.
  const image = /^image\(\) \{\n[\s\S]*?^\}$/mu.exec(script)?.[0] ?? "";

  it("builds an image only when ECR says it is not there, and stops on any other lookup failure (#46)", () => {
    expect(image).toMatch(
      /if lookup=\$\(aws ecr describe-images [^\n]*2>&1 > \/dev\/null\); then/u,
    );
    expect(image).toMatch(
      /elif [^\n]*ImageNotFoundException[^\n]*; then\n\s*docker build /u,
    );
    expect(image).toMatch(
      /else\n[\s\S]*?echo "Looking up \$repo:\$tag in ECR failed[^"]*" \| tee -a "\$summary" >&2\n\s*return 1\n\s*fi/u,
    );
  });

  // The run's log is public, and the lookup's message can name the account.
  it("logs only the failed lookup's error class, whatever its spelling (#46)", () => {
    expect(image).not.toMatch(/(?:echo|printf|tee)[^\n]*\$\{?lookup\b/u);
    const pattern = /pattern='([^']*)'/u.exec(image)?.[1] ?? "(?!)";
    const classOf = (message: string) =>
      new RegExp(pattern, "u").exec(message)?.[1];
    const tail = " when calling the DescribeImages operation: a message";
    expect(classOf(`An error occurred (AccessDeniedException)${tail}`)).toBe(
      "AccessDeniedException",
    );
    expect(classOf(`An error occurred (403)${tail}`)).toBe("403");
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
