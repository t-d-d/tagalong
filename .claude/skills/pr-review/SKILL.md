---
name: pr-review
description: "The checklist governor's PR review holds a pull request to before it merges it. Read it before raising a pull request, to see what an unattended merge needs. Run /pr-review <number> to check one by hand; it posts nothing."
argument-hint: "<pull-request-number>"
---

# PR review

Governor reads this file from main and adds it to its reviewer's prompt
(`review.checklist` in `.github/dispatch.json`). A pass merges the pull
request. A fail posts a comment saying why. Governor asks the author
session for an edit where one can meet the test. Otherwise the pull
request waits for the owner.

The reviewer sees the pull request's title and body, the changed files
with their status, and the issues the body closes. It never sees the
diff, so the body must say everything the tests below ask about.

Governor decides tests 1, 7 and 8 in code before the reviewer is asked,
so a pull request that reaches the reviewer passes them. It also checks
that every issue tests 5 and 6 name as an owner is open and not one the
pull request closes. Tests 2 to 6 are the reviewer's. Answer them in
order.

## The checklist

1. **Every issue it closes is open, has a `mode:` label, is
   `workflow: under development`, is not a `type: prd`, and is closed by
   no other open pull request.** `mode: afk`, `mode: hitl` and
   `mode: human` all pass. A ticket still `ready for development` fails
   until its session claims it. A PRD closes when its last ticket does,
   by the owner's hand ([issue-workflow.md](../../../docs/issue-workflow.md)).

2. **It closes at least one issue, says what the change buys, and that
   is what the issues it closes asked for.** Every change here starts from
   an issue readied before the work, and the body is judged against it.
   One exception: a pull request that repairs a red run of
   the deploy workflow on main may close no issue. Its body links the run,
   names the merged pull request whose change broke it, and says the
   change goes no further than the repair. Any other pull request that
   closes no issue fails.

   It also fails if a closing word sits before an issue reference
   anywhere outside the `Closes #N` lines that open the body, in any
   section, the *Verification* rows included. GitHub closes that issue at
   the merge too. A closing word is close, fix or resolve in any form,
   such as closes, fixed or resolves. An issue reference is `#N`,
   `owner/repo#N` or a full link to the issue, and the test covers all
   three. GitHub reads no negation, so "does not fix #50" and "Fixes
   #30's retry path too" both fail. "#50 is not addressed here" passes.

3. **It says what the change costs, and nothing in the cost is the
   owner's to decide.** It fails if the body or the changed files show
   any of these:
   - a new AWS service or permission, or a new paid service;
   - a change to who tagalong answers, or to what a Claude is given;
   - a test deleted, skipped or weakened that the issue did not ask to
     remove. A test file listed as removed counts, unless the issue asks
     for its removal;
   - a step only the owner can take before the change works: a Parameter
     Store value, the device, the Claude login, or an AWS or GitHub
     setting.

4. **Where it departs from an issue it closes, it narrows.** *Drift* says
   "Matches #N as written", or says where it departs and why. Doing less
   passes when the rest is under *Left for later*. Doing more than the
   issue asked fails.

5. **Every acceptance criterion of every issue it closes is answered.**
   The *Verification* table has a row for each criterion in the issue.
   Each row's *Green at* is `merge`, `deploy`, `daily`, `by hand` with the
   exact steps the owner takes, or an open issue that owns it. An issue this
   pull request closes owns nothing, since the merge closes it. A missing
   criterion, a dash, or a `by hand` row with no steps fails.

6. **Every loose end is closed.** Work left undone, and every review
   finding not fixed, is under *Left for later* with the number of an
   open issue this pull request does not close. A "follow-up", "for now"
   or "later" with no issue fails.

7. **No changed file is on the human-only list.** The list is
   `review.humanOnly` in `.github/dispatch.json`, each entry a glob and the
   reason its paths wait for the owner. A changed file matching any entry
   fails, and so does a rename away from one.

8. **The `gate` check is green on its head.** Governor waits for the gate
   to finish before it reviews.

## The answer

`pass`, or `fail` with the first failed test's number, one sentence saying
what the body would need to say to meet it, and whether any edit to the
body can make the pull request pass.

## By hand

`/pr-review <number>` reads the pull request and the issues it closes, and
reports the answer in the chat. It posts nothing. For tests 1, 7 and 8,
read the issues' labels, `review.humanOnly` and the head's check runs
yourself.
