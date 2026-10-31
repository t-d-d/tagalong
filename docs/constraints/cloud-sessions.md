# Cloud sessions
Relevance: Starting a session, sending it a follow-up, reading its answer, or environments: service/launch.py, service/src/cloud.ts, service/src/claude-api.ts, service/src/relay.ts, service/src/requests.ts
Decision: Each Claude keeps one running session per chat, started with claude --cloud in a terminal; answers are read from the sessions API the CLI uses.

Why: claude --cloud is the supported way to start a cloud session, and
it needs a terminal. The CLI's own sessions endpoints give each turn's
result, so nothing has to be scraped or posted back by the session.

## Rules

- A session starts from a bare workspace per repo and environment: an
  empty git repo whose origin is the GitHub repo, with the environment
  in .claude/settings.local.json.
- In the task, each workspace is trusted in HOME/.claude.json as it is
  made, from the CLI queue. The CLI carries a folder's trust down only
  as far as a git repo's root, and each workspace is a repo of its own,
  so trusting the folder above them does nothing. On a laptop tagalong
  leaves the CLI's config alone.
- service/launch.py runs claude --cloud in a pseudo-terminal with the
  group's permission mode, ref, model and a session name, and returns
  once the CLI prints "Resume with:".
- A Claude has one running session in each chat, used as a mailbox.
  Each time the Claude is asked, a delivery goes into the session
  straight away with claude -p --cloud session_<id>, whether or not the
  session is working: what was said in the chat since the Claude's last
  delivery, each line with a short label such as [m41], then the
  request.
- A conversation never loses its context by itself. A running session
  keeps the definition and repo it started on: redefining a Claude, or
  a skill changing in its repo, reaches a chat only when an owner runs
  @claude update there. Update, and a session that is archived or gone,
  start a new session carrying the old one's dialogue (what it was sent
  and what it answered, not the code it read or the tools it ran, at
  most CARRY_LIMIT characters, the latest kept) and everything said in
  the chat since. Only @claude fresh starts a Claude over, with the
  chat's last HISTORY messages.
- Each answer is remembered by the id the bridge stored it under and by
  a hash of its text, so a reply to it reaches the Claude that wrote
  it. An older answer with a session link in it still works.
- Answers are read from /v1/code/sessions/cse_<id>/events, after the
  last sequence number read, from a session's first delivery until it
  has had no delivery and no result for GIVE_UP_MS. tagalong notes each
  delivery's uuid from the user event that carries its text.
- A result event ends a turn. It is posted after the Claude's name in
  bold, without the session's link, unless every message its
  user_message_uuids lists came from elsewhere, such as Claude Desktop.
  A result that lists no messages, from a turn the session started by
  itself, is posted. A line the session ended with its own link is
  dropped.
- A result that is only the pass word, PASS, posts nothing. A result
  that starts with a label replies to that line, without the label.
  Otherwise it replies to the latest ask among the deliveries it lists,
  and with neither it is a plain message. A result that is only one
  emoji, with or without a label, goes as a reaction on the message it
  would have replied to, or as a message when there is none.
- A session is busy while a delivery has no result that lists it. A
  busy session waiting for an approval is mentioned once, with its
  link, the one place to approve it. A delivery with no result after
  GIVE_UP_MS is given up on, and the chat is told.
- An interjecting delivery (who-can-use-it.md) carries no request. Its
  answer is a plain message unless it starts with a label. It gets no
  👀, no approval notice, and no notice when its turn fails or it is
  given up on, since nobody waits on it. While a session is busy,
  interjecting waits; what was said goes in with the next delivery.
- tagalong reacts 👀 to a request as it delivers it, and takes the 👀
  off once no delivery that carries the request still waits. A Claude's
  own reaction on the request replaces the 👀 and is left alone.
- A reaction cannot be quoted or reacted to, so for a request that is a
  reaction on a Claude's answer, the answer stands in for the request:
  the 👀 or ⏳ goes on it, and the Claude's answer replies to it or
  reacts on it.
- Those endpoints are not documented, so every answer goes through a
  schema, and the CLI's version is pinned in the image.
- Environments are named by their names from /v1/environment_providers,
  and stored by id.

## Do not

- Run Claude Code locally in the task: the work belongs in the cloud
  environment, with its own repo access and limits.
- Ask the session to post to WhatsApp itself: it has no device.
- Put the session's link on answers: the group does not want it, and a
  reply finds its session without it.
- Restart a running conversation because its Claude was redefined: the
  group would lose what the session knew in the middle of a thread.
- Let the CLI update itself: an update can change what the launcher
  reads.
- Trust the workspaces folder and expect its workspaces to inherit it.
- Read a session to its latest event before a delivery: a turn still
  running would lose its answer.
- Stop reading a session at a turn's result: a session that works in
  the background answers in a later turn it starts by itself.

History: Set when the repo was made, October 2026, following podstow's
dispatcher. Each session is a mailbox since 27 October 2026, at the
owner's request (#17): deliveries go in at any time and every result is
posted. That replaced reading to the latest event before a follow-up
(#10). The 👀 comes off an answered request since the same day (#24).
The 👀 for a reaction goes on the answer it is on since 31 October
2026 (#45). Interjecting deliveries carry no request and get no notices
since the same day (#19).
