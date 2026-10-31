---
name: pr-description
description: "Write or rewrite a pull request title and body that a reviewer can read in one screen. Use when raising or updating a pull request (pre-push step 5 points here), or when asked to tidy a description."
---

# Pull request description

## Who reads it

Governor's PR review, the owner, and anyone reading this public repo
afterwards. The review decides whether the pull request merges. It never
reads the diff. It judges the body, the changed files and the issues
closed against the `pr-review` checklist. The owner and later readers do
not read the diff first either. They want to know whether the change is
going the right way: is it more complicated than it needs to be, and has
it drifted from what the issue, the PRD or a decision record said. Nothing
already decided there is argued again here.

The body is also the record the next session reads to learn what the
system now is.

## Inputs

Fill it from the diff, the issue and the constraint files the change
touched. Do not fill it from memory of the session. Read the diff once
more before writing, and read the issue again from GitHub: an issue edited
after you picked it up changes what the pull request must meet.

## Title

Imperative and specific. It says what changes, and for whom. "Refuse an
ask whose link is not https", not "Fix link validation".

## Body

The body opens with one `Closes #N` line for each issue the pull request
closes, one issue per line. GitHub needs a closing word before every
number, so `Closes #40, #41` closes only #40. These lines are the only
place a closing word sits next to an issue number. GitHub matches close,
fix or resolve in any form, such as closes, fixed or resolves, plus `#N`
anywhere in the body and reads no negation, so "does not fix #N" closes
it. Write "#N is not addressed here".

After the `Closes #N` lines, if there are any, the body has five sections,
each a `##` heading, in this order: *Outcome*, *Adds / removes*, *Drift*,
*Verification* and *Left for later*. Fill every one and add no others.
Aim for about 200 words before *Left for later*. Every sentence must make
sense to someone who has not opened the diff.

**Outcome.** Two or three sentences. What is true after merge that was not
before, for a user, an agent or a developer. State the effect, not the
diagnosis.

**Adds / removes.** One line per thing the system gains or loses: a
module, a route, a tool field, a dependency, a permission, a stored item,
a test tier. Removals count. Then one net line: simpler or more complex,
and what the complexity buys. Never "nothing" when a new mechanism exists.

**Drift.** Only where the pull request departs from the issue's acceptance
criteria, the PRD, a decision record, or the obvious approach, and why. A
criterion met differently from its wording goes here, first. "Matches #N
as written" when there is none.

**Verification.** A table with one row per acceptance criterion of each
issue this closes. Every criterion gets a row, including ones nothing
answers yet. The rows come from the issue, never from what the session
chose to test.

`Green at` is one of:

- `merge`: a gate test answers it.
- `deploy`: a live-tier test answers it after the deploy.
- `daily`: a conformance-tier test answers it on its next scheduled run.
- `by hand`: only the owner can check it, such as a real agent connecting
  or speech on a phone. Say exactly what to do.
- an issue number: nothing answers it yet, and that issue owns it. The
  number appears again under *Left for later*.

A dash is not a value. Below the table, say what was not checked and why,
one line each.

**Left for later.** One line per issue filed, with its number and why it
waits. "None" when there is nothing.

**A repair of a red deploy run.** Governor asks for one when a deploy run
on main goes red after a merge. It closes no issue, so it has no
`Closes #N` line and no *Verification* rows from an issue. *Outcome*
links the run and names the merged pull request whose change broke it.
*Drift* says the change goes no further than the repair. *Verification*
has one row: the failed job the repair turns green. This is the exception
in test 2 of the `pr-review` checklist.

## Not in the body

- The story of the work. No "failing test first" or "the review found".
- Test counts, line numbers, commit hashes. A number goes in only when it
  changes what the reader decides.
- A file list. The diff has it.
- A defence of a choice nobody would question.
- A restatement of the PRD or a decision record. Link it, or say where
  this departs from it.

Run the `unslop` skill over the result.

## Self-check

1. Could a reader who has not opened the diff say in one sentence what
   this adds to the system and what it costs?
2. Is the first sentence of *Drift* the thing most likely to make the
   owner stop the merge?
3. Does every acceptance criterion appear in the table, and does every
   row that is not green at merge say who checks it or which issue owns it?

## Example

An illustration of the shape, not a real pull request.

> Closes #12
>
> ## Outcome
> An agent can close its own ask. Calling `resolve` with an ask's id
> clears the card from the page. Until now a card stayed until the user
> swiped it.
>
> ## Adds / removes
> - Adds the `resolve` tool. The server now has two tools.
> - Adds a closed item for each ask, recording how it ended.
> - Net: one more tool and one more kind of stored item. Both are in the
>   PRD.
>
> ## Drift
> Matches #12 as written.
>
> ## Verification
> | Acceptance criterion | Answered by | Green at |
> |---|---|---|
> | `resolve` closes an open ask and the list no longer returns it | `service/resolve.int.ts` | merge |
> | Resolving a closed ask succeeds | `service/resolve.int.ts` | merge |
> | Another account's id is `not_found` | `service/resolve.int.ts` | merge |
> | A Claude session resolves a real ask and the card clears | The owner posts an ask from a session, replies, and watches the page | by hand |
>
> ## Left for later
> None.
