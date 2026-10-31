import { describe, expect, it } from "vitest";
import { readRepoFile } from "../test/repo.ts";

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

  it("says which image failed to build or push", () => {
    expect(script).toMatch(
      /docker build [^\n]*\|\| \{ echo "[^"]*\$uri:\$tag[^"]*" >&2; return 1; \}/u,
    );
    expect(script).toMatch(
      /docker push [^\n]*\|\| \{ echo "[^"]*\$uri:\$tag[^"]*" >&2; return 1; \}/u,
    );
  });
});
