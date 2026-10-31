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
  last sequence number read. tagalong notes each delivery's uuid from
  the user event that carries its text.
- Every session is read the same way, interjecting or not, with no time
  limit. It is read every POLL_MS while it reports running. Otherwise
  the gap between reads goes 30 seconds, then 1, 2, 5, 10 and 30
  minutes, and stays at 30; a session waiting for an approval backs off
  as an idle one does. A delivery, or a read that finds new events,
  starts the gaps again.
- A session is read until it is archived or failed and nothing is left
  to read. One that update, fresh or a new session replaced is read
  until none of its deliveries' turns is still open.
- tagalong posts only text inside <whatsapp> tags, from any message the
  Claude writes, in any turn, whatever started it: a delivery, the
  session itself, governor, or someone in the Claude app. Text outside
  the tags is never posted, and there is no pass word.
  A session started before these rules is told them once, with its
  next delivery.
- Each pair is one WhatsApp message, posted when tagalong reads it, in
  the order written, with its line breaks kept. One message from the
  Claude can hold several pairs. A pair opens and closes within one
  message. An unclosed tag posts nothing, and is logged with no text.
  Empty tags post nothing.
- With reply="m45", the message replies to line m45 while the chat
  still knows that label, and is otherwise a plain message. Without
  reply, it is a plain message. With reply and text that is only one
  emoji, it goes on that line as a reaction.
- A message is posted after the Claude's name in bold, through
  toWhatsApp, so a line the session ended with its own link is dropped,
  and it is remembered for replies. The session's uploads are sent
  after it.
- A result event ends a turn. The deliveries its user_message_uuids
  lists are answered. Its text repeats the Claude's last message, so a
  result posts nothing. A turn that ends with no result posts nothing
  either.
- tagalong posts tagged text from a Claude that is not interjecting just
  as from one that is. The brief is the only guard.
- A session is busy while a delivery's turn is open. The turn that took
  a delivery ends when a result lists it. With no result matched to it,
  it ends when a read finds the session idle, archived or failed with
  nothing new to read, once the session has done anything after the
  delivery's user event: just after a delivery goes in, the session can
  read idle before its turn starts.
- A busy session waiting for an approval is mentioned once, with its
  link, the one place to approve it. A session that ends while a
  request still has its 👀 gets tagalong's notice. There is no notice
  for a turn that runs long.
- An interjecting delivery (who-can-use-it.md) carries no request. It
  gets no 👀, no approval notice, and no notice when its turn fails or
  its session ends, since nobody waits on it. While a session is busy,
  interjecting waits; what was said goes in with the next delivery.
- A turn an interjecting Claude's running session starts by itself
  posts what it tags, as any turn does. It never starts an interjecting
  delivery, and does not count toward INTERJECT_PER_HOUR.
- tagalong reacts 👀 to a request as it delivers it, and takes the 👀
  off once no delivery that carries the request still has its turn
  open, whether or not the Claude posted anything. A Claude's
  own reaction on the request replaces the 👀 and is left alone. A turn
  that took a request and fails gets tagalong's notice.
- A reaction cannot be quoted or reacted to, so for a request that is a
  reaction on a Claude's answer, the answer stands in for the request:
  the 👀 or ⏳ goes on it, and its label stands for the answer, so the
  Claude replies to it or reacts on it.
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
- Stop reading a session because time passed: a deploy notice, a
  background job or a reminder can reach it hours after it last heard
  from the chat.
- Stop reading a session at a turn's result: a session that works in
  the background answers in a later turn it starts by itself.
- Decide what to post by what started a turn: only the Claude knows
  whether a message from governor or the Claude app calls for a word in
  the chat.
- Post a result's text: it repeats the Claude's last message.

History: Set when the repo was made, October 2026, following podstow's
dispatcher. Each session is a mailbox since 27 October 2026, at the
owner's request (#17): deliveries go in at any time and every result is
posted. That replaced reading to the latest event before a follow-up
(#10). The 👀 comes off an answered request since the same day (#24).
The 👀 for a reaction goes on the answer it is on since 31 October
2026 (#45). Interjecting deliveries carry no request and get no notices
since the same day (#19). An interjecting Claude's running session is
read until it ends, and a turn it starts by itself is not posted but
asked about, since the same day (#19, #68). One that answers a line it
was given is posted at once since the same day, at the owner's request
(#80). Only text a Claude tags for WhatsApp is posted, whatever started
its turn, and there is no pass word, since the same day, at the owner's
request (#92). Every session is read the same way, with no time limit,
and the 👀 comes off when the turn that took a request ends, with no
give-up notice, since the same day, at the owner's request (#93).
