# tagalong

Claude in your WhatsApp groups. Mention `@claude` in a group it has been set up for, and it starts a Claude Code cloud session on that group's repo, then posts the session's answer back as a reply. Reply to that answer and the same session carries on.

It runs as one small always-on task in AWS: a linked WhatsApp device (the [whatsapp-mcp](https://github.com/verygoodplugins/whatsapp-mcp) bridge) and tagalong beside it, which starts sessions with `claude --cloud` and reads their answers from the sessions API.

```
WhatsApp group ──> bridge ──webhook──> tagalong ──claude --cloud──> cloud session
      ^                                   │                              │
      └───────────── reply ───────────────┴──── sessions API (answer) <──┘
```

## Using it

In a group, the owner types `@claude help`. tagalong answers with messages to copy, edit and send back:

- `@claude setup owner/repo read-write env="Default Full"` sets the group up for a repo and an environment.
- `@claude allow @Name` and `@claude revoke @Name` say who else may ask.
- `@claude status` says how the group is set up, and `@claude stop` makes tagalong ignore it again.

Then anyone allowed asks: `@claude why is the build red?` Photos and files they sent in the last ten minutes go with the request.

Only owners can run commands. tagalong ignores anyone an owner has not allowed, and any group nobody has set up ([who-can-use-it.md](docs/constraints/who-can-use-it.md)).

## Running it

- [docs/bootstrap.md](docs/bootstrap.md): the accounts, the first deploy and moving the device, once.
- [docs/setup.md](docs/setup.md): working on the code, the operator's commands, and what to do when something breaks.
- [PRD.md](PRD.md): what version 1 does and leaves out.

It costs about $8 a month: the Spot task, its public IPv4 address, and a few cents of EFS, S3 and logs. The sessions use the Claude account's own plan.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
