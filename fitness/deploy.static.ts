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
});
