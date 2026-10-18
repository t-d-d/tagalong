# Who can use it
Relevance: Who tagalong answers, who may set a group up, what a session is given, or a command: service/src/access.ts, service/src/commands.ts, service/src/prompts.ts, service/src/requests.ts, service/src/attachments.ts, service/src/groups.ts
Decision: Owners set groups up from WhatsApp; tagalong answers only owners and the members they named, in groups set up for it, and ignores the rest.

Why: Anyone can add the number to a group, and a session can change a
repo. So being in a group gives nothing: an owner says which repo, how
much access, and who may ask.

## Rules

- Owners are the numbers in /tagalong/owners and in groups.json. A
  person is matched on their number or their LID, never on a name.
- A group is answered only once an owner has set it up. Until then
  nothing about it is logged or kept.
- Each group names one repo, an environment, an access level and its
  members. read-write starts sessions in auto mode; read-only in
  dontAsk mode, with an instruction not to change anything.
- A command is "@claude <verb>" at the start of a message, or a mention
  of Claude's number. Only an owner's own number may run one, only in a
  message stored in the last ten minutes, and never from Claude's own
  messages.
- A command-shaped message is never a request, whoever sends it.
- A session is given the request, recent messages from owners, members
  and Claude only, with commands left out, and files from members sent
  in the last ten minutes.
- At most MAX_PER_HOUR requests start or continue a session in an hour.
- groups.json is checked by its schema before it is written. A change
  that does not pass writes nothing.

## Do not

- Answer anyone in a group because they are in it.
- Match an owner by contact name: anyone can choose any name.
- Give a session the whole chat: people who are not members said it.
- Let a group's members set it up or add people.

Judgment: read-only rests on the permission mode and the instruction,
not on a sandbox. A group whose repo matters is read-write only for
people trusted with the repo.
History: Set when the repo was made, October 2026.
