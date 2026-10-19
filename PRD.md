# tagalong, version 1

## The problem

A few people talk about their side projects in WhatsApp groups. When a question needs the code ("is the Atlantic scraper fixed?", "why is the build red?"), someone has to leave the chat, open Claude Code, explain the context, and paste the answer back. Claude should be in the group instead, answering from the repo the group is about.

## What version 1 does

1. Keeps a catalogue of named Claudes, each a repo, an environment, an access level (read-write in auto mode, or read-only in dontAsk mode and told not to change anything), a ref, a model and an optional role: a brief sent at the start of its sessions, which can name a skill from the repo.
2. Lets an owner add Claudes to a group or a one-to-one chat, and say who else may ask each one there, or open a read-only one to everyone in the chat. Nothing answers in a chat with no Claudes, and there is no default Claude.
3. Answers a Claude asked by name (`@podstow`), or by a reply to one of its answers, from an owner or someone allowed to ask that Claude in that chat. One message can ask several.
4. Keeps one running cloud session per Claude per chat. Each turn carries what the people who may ask it said in the chat since that Claude's last turn, the other Claudes' answers included, then the request, and any photos or files members sent in the last ten minutes, as links that last an hour. A Claude's first session in a chat starts with the chat's last messages.
5. Posts each answer as a reply to the request, after the Claude's name. Says once when a session waits for an approval, and says when it has had no answer for two hours.
6. Keeps each chat on the version of a Claude its conversation started with. An owner moves it to the current definition and repo with `update`, which carries the conversation over, as does a session that was archived. `fresh` starts it over.
7. Lets an owner run it all from WhatsApp: `define`, `undefine`, `add`, `remove`, `allow`, `revoke`, `update`, `fresh`, `who`, `stop` and `help`, with environments named by their names.
8. Runs as one always-on Fargate Spot task in its own AWS account, deployed by a merge to main, and emails the owner on an error line, a silent bridge or a high bill.

## Out of scope

- Claudes that chip in without being asked. Later, a setting on a Claude could let it hear every turn and answer only when it has something to add, with a word tagalong never posts and a limit of its own.
- Claudes asking each other. Later, an answer naming another Claude could ask it, with a limit on how deep a chain goes and how many turns an hour, so they cannot loop.
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
