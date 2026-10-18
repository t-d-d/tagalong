# Cloud sessions
Relevance: Starting a session, sending it a follow-up, reading its answer, or environments: service/launch.py, service/src/cloud.ts, service/src/claude-api.ts, service/src/relay.ts, service/src/requests.ts
Decision: Sessions start the way podstow's dispatcher starts them, with claude --cloud in a terminal; answers are read from the sessions API the CLI itself uses.

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
- A reply to Claude's message carries on the session linked in it, with
  claude -p --cloud session_<id>. A session that is archived or gone is
  replaced by a new one.
- Answers are read from /v1/code/sessions/cse_<id>/events, after the
  last sequence number read. A result event ends a turn; its text is
  posted as a reply to the request, with the session's link.
- A session waiting for an approval is mentioned once. A turn with no
  answer after GIVE_UP_MS is given up on, with the link.
- Those endpoints are not documented, so every answer goes through a
  schema, and the CLI's version is pinned in the image.
- Environments are named by their names from /v1/environment_providers,
  and stored by id.

## Do not

- Run Claude Code locally in the task: the work belongs in the cloud
  environment, with its own repo access and limits.
- Ask the session to post to WhatsApp itself: it has no device.
- Let the CLI update itself: an update can change what the launcher
  reads.
- Trust the workspaces folder and expect its workspaces to inherit it.

History: Set when the repo was made, October 2026, following podstow's
dispatcher.
