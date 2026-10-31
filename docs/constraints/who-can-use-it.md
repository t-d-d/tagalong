# Who can use it
Relevance: Who tagalong answers, which Claudes a chat has, who may change that, what a Claude is given, or a command: service/src/access.ts, service/src/addressing.ts, service/src/commands.ts, service/src/prompts.ts, service/src/requests.ts, service/src/attachments.ts, service/src/groups.ts
Decision: Owners define Claudes, add them to chats and say who may ask each one there; a Claude answers and hears only those people, and other chats are ignored.

Why: Anyone can add the number to a group, and a Claude can change a
repo. So being in a chat gives nothing: an owner says which Claudes are
there and who may ask them.

## Rules

- Owners are the numbers in /tagalong/owners and in groups.json. A
  person is matched on their number or their LID, never on a name.
- A Claude is a name for a context: a repo, an environment, an access
  level, a ref, a model and an optional role, a brief sent at the start
  of each of its sessions. Several Claudes can share a repo and differ
  by role. The catalogue in groups.json defines each once, for every
  chat. read-write starts sessions in auto mode;
  read-only in dontAsk mode, with an instruction not to change anything.
- A chat is a group or a one-to-one chat with the number; both work the
  same. A chat is answered only once an owner has added a Claude to it.
  Until then nothing about it is logged or kept.
- A Claude is asked by "@name" anywhere in a message, by a reply to
  one of its answers, or by a reaction on its latest answer in the
  chat. One message can ask several. "@claude" with no command, or a
  name not in the chat, gets told who is there. Nothing else asks a
  Claude: a Claude's own answer never does, nor does a reaction taken
  off, the device's own reaction, or one on an older answer, a
  person's message or one of tagalong's notices.
- A command is "@claude <verb>" at the start of a message, or a mention
  of the number. Only an owner's own number may run one, only in a
  message stored in the last ten minutes, and never from tagalong's own
  messages. "claude" is never a Claude's name.
- A command-shaped message is never a request, whoever sends it.
- Who may ask a Claude is set per Claude, per chat: owners always, and
  the people an owner allowed for that Claude in that chat. Allowing
  someone for one Claude does not let them ask another, here or in
  any other chat. A Claude added to a chat starts with only the owners.
- An owner may open a read-only Claude to everyone in a chat. A
  read-write Claude is never open to everyone, whatever groups.json
  says: anyone a group admin adds could then change its repo.
- A Claude is given its request, and, since its last turn, the chat's
  messages from the people who may ask it and the Claudes' answers,
  with commands left out, and files those people sent in the last ten
  minutes, once each. It is told only its request is an instruction.
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
- Let anyone allowed for one Claude ask, or be heard by, the others.
- Open a read-write Claude to everyone in a chat.

Judgment: read-only rests on the permission mode and the instruction,
not on a sandbox. A Claude whose repo matters is read-write only in
chats with people trusted with the repo.
History: Set when the repo was made, October 2026. Named Claudes
replaced one repo per group on 19 October 2026, at the owner's request.
A reaction on a Claude's latest answer asks it since 31 October 2026,
at the owner's request (#45).
