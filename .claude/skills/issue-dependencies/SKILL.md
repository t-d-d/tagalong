---
name: issue-dependencies
description: "Read and write GitHub's blocked-by and blocking links between issues. Use when you need to know which issues block which, when filing a ticket that must wait for another, or on behalf of fetch-ticket and prd-to-issues."
---

# Issue dependencies

GitHub links issues as blocked by and blocking. The links show in the issue's Relationships panel, and governor reads them: it starts a ready ticket only when none of its blockers is open ([issue-workflow.md](../../../docs/issue-workflow.md)). They are the only record of order. Never write a "Blocked by" line in a body instead.

The GitHub MCP tools do not reach these endpoints, so this skill has a small script, `gh-deps`, over the REST API. Every other GitHub route is the `github-tooling` skill.

## The script

`.claude/skills/issue-dependencies/gh-deps`, run from the repo root. It needs `gh`, which a cloud session has, and works on this repo unless `GH_REPO` names another.

```
gh-deps list-blockers <issue>              # what <issue> is blocked by
gh-deps list-blocking <issue>              # what <issue> blocks
gh-deps list-blockers-transitive <issue>   # every issue upstream
gh-deps list-blocking-transitive <issue>   # every issue downstream
gh-deps add-blocker <issue> <blocker>      # <issue> is now blocked by <blocker>
gh-deps remove-blocker <issue> <blocker>   # remove that link
```

It prints one issue number per line, or nothing. Put `--json` first for the full payloads: `gh-deps --json list-blockers 12`.

Only the blocked-by side can be written. GitHub fills in the blocker's blocking list itself, so one call is enough.

## When to use it

- **Filing a ticket that must wait:** once it exists, `gh-deps add-blocker <new> <blocker>`. Add every blocker before you add `workflow: ready for development`, or governor may start it first.
- **Checking whether a ticket is blocked:** `gh-deps list-blockers <n>`, then check whether each one is still open.
- **Before closing an issue:** `gh-deps list-blocking <n>` shows what the close frees.

## Search does not see them

GitHub's search qualifiers `is:blocked`, `blocked-by:N` and `blocking:N` do not reliably match these links. Use the script.

## Errors

- A missing issue: `gh` returns 404 and the script exits non-zero.
- Adding a link that exists: a 4xx. Treat it as done, and run `list-blockers` to confirm.
- A pull request on either side: 422, "Target issue may only be an issue". Link the issue the pull request closes instead.
- A cycle: GitHub refuses the write.
