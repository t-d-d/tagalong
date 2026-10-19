# tagalong

Claudes in your WhatsApp chats. Each Claude has a name and its own context: a repo, a cloud environment, an access level, a model and, if you like, a role, so `@podstow` and `@ops` can share a repo and still work differently. Add a few to a group, ask one by name (`@podstow why is the build red?`, `@brainstorm go wide on this`), and it answers in the chat. Each keeps one running Claude Code cloud session per chat, and hears what was said since its last turn, the other Claudes included.

It runs as one small always-on task in AWS: a linked WhatsApp device (the [whatsapp-mcp](https://github.com/verygoodplugins/whatsapp-mcp) bridge) and tagalong beside it, which starts sessions with `claude --cloud` and reads their answers from the sessions API.

```
WhatsApp group ──> bridge ──webhook──> tagalong ──claude --cloud──> cloud session
      ^                                   │                              │
      └───────────── reply ───────────────┴──── sessions API (answer) <──┘
```

## Its number

tagalong is a WhatsApp account of its own: people add its number to a group, or message it directly, and its answers come from that number. So it needs a number of its own, with WhatsApp set up on a phone that keeps it. The bridge then joins that account as a linked device, the way WhatsApp Web does.

- Use a spare number, such as a cheap SIM or an eSIM, not your own. tagalong ignores every message its own account sends, so if it ran on your number nothing you typed would reach it. It would also store every chat on that number, not only the ones with Claudes in.
- An ordinary WhatsApp account works, and so does the free WhatsApp Business app. A WhatsApp Business Platform (Cloud API) number does not: the bridge is a linked device, and those numbers have no app to link to.
- The phone has to come online now and then. WhatsApp logs out linked devices on a phone that has been offline for about two weeks.
- The bridge is not an official WhatsApp client, and WhatsApp can ban numbers that use one. Pick a number you could lose.

## Using it

The owner types `@claude help` in a chat. tagalong answers with messages to copy, edit and send back:

- `@claude define ops owner/podstow read-only role="You are Podstow's ops operator. Use the ops-tooling skill."` defines a Claude, once, for every chat.
- `@claude undefine critic` deletes a Claude's definition and forgets its conversations. It refuses while the Claude is still in a chat, and names the chats to remove it from first.
- `@claude add podstow brainstorm` and `@claude remove brainstorm` say which Claudes are in this chat.
- `@claude allow @Name podstow` and `@claude revoke @Name podstow` say who else may ask each Claude in this chat. `@claude allow everyone brainstorm` opens a read-only Claude to everyone here.
- A chat keeps talking to the version of a Claude it started with. `@claude update brainstorm` moves it to the current definition and repo, carrying its conversation over. `@claude fresh brainstorm` starts it over with only the last messages.
- `@claude who` lists who is here, and `@claude stop` makes tagalong ignore the chat again.

Then anyone allowed asks a Claude by name. Photos and files they sent in the last ten minutes go with the request. A voice note goes with its transcript, by Amazon Transcribe. A Claude can send pictures, audio and files back with its answer. A one-to-one chat with the number works the same as a group.

Only owners can run commands. tagalong ignores anyone an owner has not allowed, and any chat with no Claudes ([who-can-use-it.md](docs/constraints/who-can-use-it.md)).

## Running it

- [docs/bootstrap.md](docs/bootstrap.md): the accounts, the first deploy and moving the device, once.
- [docs/setup.md](docs/setup.md): working on the code, the operator's commands, and what to do when something breaks.
- [PRD.md](PRD.md): what version 1 does and leaves out.

It costs about $8 a month: the Spot task, its public IPv4 address, and a few cents of EFS, S3 and logs. The sessions use the Claude account's own plan.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
