---
name: prd-to-issues
description: "Break a ready PRD into a delivery train of tickets, agree the train with the owner, and file it. Use to turn a PRD into tickets, to judge whether a PRD is ready to break down, or to suggest tickets for one."
---

# PRD to issues

Break a PRD into a **delivery train**: tickets in order, where every merge leaves tagalong better than before and working at every step. This skill needs the owner in the session. It files only a train the owner approved, since filing it readies its enhancements and governor starts them ([issue-workflow.md](../../../docs/issue-workflow.md)).

Do not suggest a breakdown, even informally, without applying the test below. The usual mistake is a list of modules or layers that each need a sibling before they do anything.

## The delivery-train test

For each ticket, ask: **if only this merged and nothing after it ever did, would tagalong be better?** Three ways to pass:

1. **Enhancement** (`type: enhancement`): someone can do something they could not before. A small part of a journey counts.
2. **NFR** (`type: nfr`): a quality is now met: more reliable, more secure, faster, or easier to see into.
3. **Refactor** (`type: refactor`): existing code is simpler or safer, and behaves the same.

Anything else is **groundwork**: code that does nothing until a later ticket lands. Fold it into the ticket that makes it useful. The usual cases:

- a field in groups.json or state.json that nothing reads;
- a parser whose output nothing uses;
- a command that tagalong recognises but does nothing with;
- a stack resource with no code that uses it;
- "foundations" or "preparatory work".

A refactor restructures what is there. Adding a module nothing uses is not one.

## Process

### 1. Find the PRD

Ask for its number if it is not in context, and read it with every issue it links. If it is not `workflow: ready for development`, say so. You may still draft a train and say what is missing, but file nothing.

### 2. Read the code

Read enough to see how things stand, especially to find refactors worth doing before new work lands on top.

### 3. Draft the train

Start from the PRD's user journeys. For each, find the smallest change that ships some part of it end to end. A rough version is fine, with a fixed default, one option or no command to change it, as long as it delivers the journey. Thicker slices follow and build on it.

Put a refactor before the ticket that benefits from it, where it improves the code as it stands. Never invent one to justify groundwork.

Give each ticket a mode:

- `mode: afk`, the default: a session takes it to a pull request on its own, including work that needs judgement, such as wording, since the review checks it.
- `mode: hitl`: only when you can name a decision the owner must make while the work is in flight.
- `mode: human`: only the owner can do it, such as a Parameter Store value or an AWS setting. Make it a `type: chore`, and never mix its steps into a ticket a session works.

**Order the train with blockers only.** Governor starts every ready, unblocked `mode: afk` ticket at once. Wherever two slices should not run side by side, because one needs the other's code or they touch the same files, block one on the other. Slices left unblocked must be safe to build together.

Rules for each ticket:

- It passes the delivery-train test. No groundwork.
- An enhancement cuts through everything it needs, from the stack to the command to the reply in the chat, in one merge.
- An NFR improves something that already runs.
- A refactor changes no behaviour. The gate is green before and after.
- Prefer many thin tickets to a few thick ones, but none so thin it fails the test.

### 4. Agree it with the owner

Present the train as a numbered list in merge order. For each ticket give:

- the title, type and mode;
- what it is blocked by, if anything;
- what it delivers: for an enhancement, what someone can do after it merges; for an NFR, the quality now met; for a refactor, what improves and what behaviour stays; for a chore, the ticket it unblocks.

Say for each that it passes the test, and fold any that fails into a neighbour. Ask whether the size of each ticket is right, whether the blockers are right, and whether anything should merge or split. Iterate until the owner approves.

### 5. File the tickets

Use the matching template in `.github/ISSUE_TEMPLATE/`, with the type and mode labels. Create them in train order, so blockers have real numbers. Refer to the PRD's sections rather than copying them.

Add each ticket to the PRD as a sub-issue: `mcp__github__sub_issue_write`, or `gh api repos/{owner}/{repo}/issues/<prd>/sub_issues -F sub_issue_id=<the ticket's id>`, where the id is the `id` field of the ticket, not its number.

### 6. Record the blockers

With the `issue-dependencies` skill, one call per blocker:

```
.claude/skills/issue-dependencies/gh-deps add-blocker <ticket> <blocker>
```

### 7. Ready the train

Only once every ticket and every blocker exists: add `workflow: ready for development` to each ticket that meets the readiness criteria, then replace the PRD's `workflow: ready for development` with `workflow: under development`. A ticket readied any earlier could start before its blockers are recorded.
