# tagalong, version 1

## The problem

A few people talk about their side projects in WhatsApp groups. When a question needs the code ("is the Atlantic scraper fixed?", "why is the build red?"), someone has to leave the chat, open Claude Code, explain the context, and paste the answer back. Claude should be in the group instead, answering from the repo the group is about.

## What version 1 does

1. Answers `@claude`, a mention of its number, or a reply to one of its messages, in a group an owner has set up, from an owner or a member they named.
2. Starts a Claude Code cloud session for each new request, on the group's repo, in the group's environment, with its access level: read-write (auto mode) or read-only (dontAsk mode, told not to change anything).
3. Gives the session the request, the group's recent messages from owners, members and Claude, and any photos or files members sent in the last ten minutes, as links that last an hour.
4. Posts the session's answer as a reply to the request. A reply to that answer is sent to the same session; if it has been archived, a new one starts.
5. Says once when a session waits for an approval, and says when it has had no answer for two hours.
6. Lets an owner set a group up from WhatsApp: `setup`, `allow`, `revoke`, `status`, `stop` and `help`, with environments named by their names.
7. Runs as one always-on Fargate Spot task in its own AWS account, deployed by a merge to main, and emails the owner on an error line, a silent bridge or a high bill.

## Out of scope

- Creating groups, or joining one by itself.
- More than one WhatsApp device, or more than one task.
- Pairing a device in the cloud. A device is paired on a laptop and moved.
- Approving a session's actions from WhatsApp.
- Sending files or images back to WhatsApp.
- Transcribing voice notes.
- Progress messages while a session works.
- A real read-only sandbox. read-only rests on the permission mode and the instruction.
- A web page or dashboard.
- Starting on demand, or running without an always-on task.
- Slack or any other chat.
