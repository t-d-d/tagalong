# Issues and labels

How tickets are labelled, when one is ready, and what governor does with it. How to reach GitHub is the `github-tooling` skill. The scheme follows podstow's, cut down for a repo this size.

## What issues are for

An issue sets work in context: a hand-off between sessions, a decision, or work deferred. The pull request, not the issue, records what was done. A review finding the branch did not cause, or one too big to fix there, gets an issue, linked from the pull request's *Left for later*.

The body is the source of truth. A session works from the title, the body and the issues it links, not from the comments. Fold any decision made in a comment back into the body before the ticket is ready.

## Labels

Every issue has one `type:` label. An implementation ticket (a bug, enhancement, NFR, refactor or chore) also has one `mode:` label, and a `workflow:` label once its spec is complete. A PRD has a `type:` label and, once readied, a `workflow:` label, but no `mode:` label.

### Type

| Label | For |
| --- | --- |
| `type: bug` | Something is broken. |
| `type: enhancement` | A user can do something they could not do before. |
| `type: nfr` | A quality is met that was not: reliability, security, performance or observability. The user may be the owner or the system. |
| `type: refactor` | Existing code is simpler or safer and behaves the same. Never groundwork for a later feature. |
| `type: chore` | Setup only the owner can do: a Parameter Store value, the device, the Claude login, or an AWS or GitHub setting. |
| `type: prd` | A product change bigger than one ticket: its goals, non-goals, user journeys and acceptance criteria. Its tickets are its sub-issues. |

### Workflow

| Label | Means |
| --- | --- |
| `workflow: ready for development` | The spec is complete. Governor starts it, if it is `mode: afk`, once it has no open blocker. |
| `workflow: under development` | Claimed. It stays on until the issue closes. |
| `workflow: duplicate` | Closed as a copy of the issue its closing comment names. |
| `workflow: wontfix` | Closed without doing it. The closing comment says why. |
| `workflow: invalid` | Closed as not a real issue, or filed in error. |
| `workflow: cannot reproduce` | Closed as believed real, after a real attempt to reproduce it failed. The closing comment says what was tried. Reopen it if it comes back. |

No `workflow:` label means the spec still needs work.

### Mode

Each implementation ticket has exactly one.

| Label | Means |
| --- | --- |
| `mode: afk` | A session takes it from the issue to a pull request on its own. This is the default, and it covers work that needs judgement, such as wording or naming, since the review checks it. |
| `mode: hitl` | A person must make a decision while the work is in flight, one that cannot be settled in the issue first. The body names that decision. The owner starts the session. |
| `mode: human` | Only the owner can do it, so it is almost always `type: chore`. Governor never starts it. |

A ticket that mixes the owner's steps with work a session can do is split in two, with a blocker recording which goes first.

## Ready

A ticket is ready when a session could work it from the title, the body and the issues it links, without asking anyone. Every implementation ticket has a *Cost of not doing* section: two or three lines on who loses what if it never ships, and how often. The who is a user, the owner or the next session. If the honest answer is "little", do not file it.

Then, by type, using the templates in `.github/ISSUE_TEMPLATE/`:

- **Bug:** steps to reproduce, expected and actual, what was seen, and acceptance criteria. What was seen is an error, a log line's event and reason, or a failed run, never message text, a number or a name ([public-repo.md](constraints/public-repo.md)).
- **Enhancement:** what it delivers, the user stories and the acceptance criteria.
- **NFR:** the quality it improves, the user stories and the acceptance criteria, measurable where they can be.
- **Refactor:** what changes shape, why the current shape hurts, and the behaviour that must not change.
- **Chore:** the owner's steps, the acceptance criteria, and where the repo documents the setup ([bootstrap.md](bootstrap.md) or [setup.md](setup.md)), so nobody needs the closed ticket to rebuild it.
- **PRD:** goals, non-goals, user journeys, acceptance criteria and related decisions, with no open questions left.

A choice is an open question only if it changes what done means. A ticket that names two acceptable approaches, what each costs and which is preferred is complete: the session picks one and says which in its pull request. A ticket that cannot start until a date passes or something outside happens is not ready, however complete its spec. Its body says what readies it.

Every new ticket passes one test: if it merged and nothing after it ever did, tagalong would be better. Groundwork that pays off only when a later ticket lands goes in that ticket. A bug passes by fixing what broke, and a chore passes with the ticket it unblocks.

## Who applies which label

- Whoever files a ticket gives it a `type:` label and, for an implementation ticket, a `mode:` label. They add `workflow: ready for development` once it is ready, and take it off again if an open question is added.
- A session readies an enhancement only when it is a sub-issue of a PRD the owner has readied, one that is `ready for development` or `under development`. A new capability starts from a PRD, not from a session's own ticket.
- A PRD's `workflow:` label moves only when the owner says so. The owner readies it, and `prd-to-issues` moves it to `under development` when it files a train the owner approved. The owner closes it.
- Governor claims a ticket it starts. A session that starts a ticket any other way claims it itself: it takes off `ready for development` and adds `under development`.

## Dependencies

Order lives in GitHub's own blocked-by links, never in the body or a label. Read and write them with the `issue-dependencies` skill. A ticket is blocked while any of its blockers is open.

Ready and blocked are separate. Ready a ticket as soon as its spec is complete, even with open blockers. Governor starts a ready `mode: afk` ticket the moment its last blocker closes, and it starts every such ticket at once, so readying several unblocked tickets together starts them together. Wherever two tickets should not run side by side, because one needs the other's code or they touch the same files, record a blocker. A line in the body saying why helps the session, but only the link stops governor.

## Lifecycle

An implementation ticket:

```
filed -> spec work (no workflow label) -> ready for development
      -> under development -> pull request -> the merge closes it
```

A stuck session comments on the issue with what it tried and leaves `under development` on, so the ticket is not started again.

When the fix turns out to cost more than the fault, at pickup, while building or at review, stop there. Close the ticket `workflow: wontfix` in place of `under development`, with a comment giving what the ticket estimated and what it turned out to be, in lines, files or reach where there are numbers. That comment is the deliverable, and it stops the ticket being filed again. Stopping because the work is hard is a different thing, and the comment's numbers are what tell the two apart.

A PRD:

```
filed, no label (discussion or backlog) -> ready for development (the owner agrees it)
      -> under development (its train is filed) -> closed (every sub-issue closed)
```

The `write-a-prd` skill drafts one with the owner, and `prd-to-issues` breaks a ready one into tickets once the owner approves the train. A pull request never closes a PRD. A PRD's label starts nothing, since governor reads only each ticket's own labels. To pause a PRD, take `ready for development` off each of its tickets that should wait.

## Not labels

- No area or priority labels. The title says what a ticket is about, and *Cost of not doing* says how much it matters.
- A duplicate closes with `workflow: duplicate` and a link to the original.
