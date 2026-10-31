---
name: write-a-prd
description: "Draft a PRD with the owner, by interview and by reading the repo, and file it as a type: prd issue. Use when the owner wants to plan a new capability, write a PRD, or turn a backlog PRD into one that can be readied."
---

# Write a PRD

A PRD is an issue labelled `type: prd` ([issue-workflow.md](../../../docs/issue-workflow.md)). It says what changes for the people using tagalong, and why. The code decides how. This skill needs the owner in the session. Skip any step that is not needed, except the premise round and stating the premises, steps 2 and 5.

1. **Ask the owner** for the problem, in detail, and any ideas for solving it. If a backlog PRD already covers it, start from that issue and edit it rather than filing another.

2. **The premise round.** Before reading the code or talking about a solution, establish that the problem is real. Ask these four, and push on each until you hear the kind of answer named. When the evidence is already concrete, the round closes in one exchange. When it is not, keep pushing until it is.

   - **Who asked for this, and what is the evidence?** Push until you hear a chat where it came up, a request that failed, an alert, or the owner's own repeated friction. Red flags: "people might want", "it would be nice", "an obvious gap".
   - **What do they do today without it, and what does that cost?** Push until you hear a workaround with a cost: a step someone repeats, something they give up on, a question nobody asks a Claude because it would not work. "Nothing" usually means the pain is not real yet.
   - **Name the moment.** Push until you hear which chat, which command or request, and what point in it, or for the owner, which alert, command or step in [setup.md](../../../docs/setup.md). "Group members" is a filter, not a person.
   - **What happens if we do nothing?** Push until you hear a specific consequence.

   Take a position on every answer and say what evidence would change it. The first answer is the polished one, so push a second time before taking it as settled. Say "this holds because" or "this is wrong because", never "that's interesting". When the owner pushes back twice with reasons, accept it and move on.

3. **Read the repo** to check what the owner said and see how things stand. Read every constraint file the idea touches (the `constraints` skill's catalogue).

4. **Interview** one question at a time until you agree. Start from the premises the round settled. Keep each question on how people move through tagalong over time, not on how to build it. When the owner moves on to implementation, note the decision for step 7 and go back to the journeys.

5. **State the premises.** List the premises the PRD rests on as numbered statements and get the owner's agreement or disagreement on each. A disagreement reopens that thread. Draft no journeys on a premise the owner has not accepted.

6. **Draft the user journeys.** Each is a named path through states over time, spanning several tickets. Good: "An owner adds a Claude to a group, a member asks it a question, it answers, the member replies to the answer, and the same Claude answers again." Bad: "A member can reply to an answer." Single capabilities belong on the enhancement tickets, not the PRD.

7. **Decisions that bind later work.** A decision that changes what a rule in `docs/constraints/` means needs an issue the owner agrees to (CLAUDE.md). File it, and link it and every constraint file the PRD touches under *Related decisions*. Do not put technical design in the PRD.

8. **File it** with `.github/ISSUE_TEMPLATE/prd.md`, labelled `type: prd` and nothing else. The owner readies it when its open questions are empty. Breaking it into tickets is the `prd-to-issues` skill.

The PRD holds a summary, goals, non-goals, user journeys, acceptance criteria, related decisions and open questions. It holds no technical design, module list or file paths.
