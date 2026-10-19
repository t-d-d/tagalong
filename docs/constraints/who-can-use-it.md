# Who can use it
Relevance: Who tagalong answers, which Claudes a chat has, who may change that, what a Claude is given, or a command: service/src/access.ts, service/src/addressing.ts, service/src/commands.ts, service/src/prompts.ts, service/src/requests.ts, service/src/attachments.ts, service/src/groups.ts
Decision: Owners define Claudes and add them to chats; a Claude answers only owners and named members who ask it by name, and every other chat is ignored.

Why: Anyone can add the number to a group, and a Claude can change a
repo. So being in a chat gives nothing: an owner says which Claudes are
there and who may ask them.

## Rules

- Owners are the numbers in /tagalong/owners and in groups.json. A
  person is matched on their number or their LID, never on a name.
- A Claude is a name for a context: a repo, an environment, an access
  level, a ref and a model. The catalogue in groups.json defines each
  once, for every chat. read-write starts sessions in auto mode;
  read-only in dontAsk mode, with an instruction not to change anything.
- A chat is a group or a one-to-one chat with the number; both work the
  same. A chat is answered only once an owner has added a Claude to it.
  Until then nothing about it is logged or kept.
- A Claude is asked by "@name" anywhere in a message, or by a reply to
  one of its answers. One message can ask several. "@claude" with no
  command, or a name not in the chat, gets told who is there. Nothing
  else asks a Claude: a Claude's own answer never does.
- A command is "@claude <verb>" at the start of a message, or a mention
  of the number. Only an owner's own number may run one, only in a
  message stored in the last ten minutes, and never from tagalong's own
  messages. "claude" is never a Claude's name.
- A command-shaped message is never a request, whoever sends it.
- A Claude is given its request, the chat's messages from owners,
  members and the Claudes since its last turn, with commands left out,
  and files from members sent in the last ten minutes, once each.
- At most MAX_PER_HOUR turns start or continue a session in an hour,
  counting each Claude asked.
- groups.json is checked by its schema before it is written. A change
  that does not pass writes nothing.

## Do not

- Answer anyone in a chat because they are in it.
- Match an owner by contact name: anyone can choose any name.
- Give a Claude the whole chat: people who are not members said it.
- Let a chat's members add Claudes or people.
- Give a chat a default Claude: nothing answers until a Claude is named.

Judgment: read-only rests on the permission mode and the instruction,
not on a sandbox. A Claude whose repo matters is read-write only in
chats with people trusted with the repo.
History: Set when the repo was made, October 2026. Named Claudes
replaced one repo per group on 19 October 2026, at the owner's request.
