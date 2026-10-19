# tagalong

Claudes in your WhatsApp chats. Each Claude has a name and its own context: a repo, a cloud environment, an access level and a model. Add a few to a group, ask one by name (`@podstow why is the build red?`, `@brainstorm go wide on this`), and it answers in the chat. Each keeps one running Claude Code cloud session per chat, and hears what was said since its last turn, the other Claudes included.

It runs as one small always-on task in AWS: a linked WhatsApp device (the [whatsapp-mcp](https://github.com/verygoodplugins/whatsapp-mcp) bridge) and tagalong beside it, which starts sessions with `claude --cloud` and reads their answers from the sessions API.

```
WhatsApp group ──> bridge ──webhook──> tagalong ──claude --cloud──> cloud session
      ^                                   │                              │
      └───────────── reply ───────────────┴──── sessions API (answer) <──┘
```

## Using it

The owner types `@claude help` in a chat. tagalong answers with messages to copy, edit and send back:

- `@claude define brainstorm owner/kickoff read-only env="Default Full"` defines a Claude, once, for every chat.
- `@claude add podstow brainstorm` and `@claude remove brainstorm` say which Claudes are in this chat.
- `@claude allow @Name podstow` and `@claude revoke @Name podstow` say who else may ask each Claude in this chat. `@claude allow everyone brainstorm` opens a read-only Claude to everyone here.
- `@claude fresh brainstorm` starts one over, `@claude who` lists who is here, and `@claude stop` makes tagalong ignore the chat again.

Then anyone allowed asks a Claude by name. Photos and files they sent in the last ten minutes go with the request. A one-to-one chat with the number works the same as a group.

Only owners can run commands. tagalong ignores anyone an owner has not allowed, and any chat with no Claudes ([who-can-use-it.md](docs/constraints/who-can-use-it.md)).

## Running it

- [docs/bootstrap.md](docs/bootstrap.md): the accounts, the first deploy and moving the device, once.
- [docs/setup.md](docs/setup.md): working on the code, the operator's commands, and what to do when something breaks.
- [PRD.md](PRD.md): what version 1 does and leaves out.

It costs about $8 a month: the Spot task, its public IPv4 address, and a few cents of EFS, S3 and logs. The sessions use the Claude account's own plan.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
