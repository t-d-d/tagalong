# The Claude login
Relevance: The login sessions are started with, its refresh, or any CLI run: service/src/login.ts, service/src/cloud.ts, service/src/run.ts, scripts/mint-claude-login.ts
Decision: Sessions start from a claude.ai login of its own, kept in Parameter Store; every refresh the CLI makes is written back, and CLI runs go one at a time.

Why: Cloud sessions need a full claude.ai login with the sessions
scope; a setup-token cannot start one. Each refresh replaces the
refresh token, so a login shared with a laptop, or two CLIs refreshing
at once, kills one of them.

## Rules

- The login is minted once with scripts/mint-claude-login.ts and is
  used by tagalong alone. It is a SecureString at
  /tagalong/claude-login, holding the credentials file verbatim beside
  the account's uuids.
- At start the task writes it to HOME/.claude/.credentials.json, unless
  the volume already holds a newer refresh of the login the task last
  stored, which it writes back. A stored login other than the one the
  task last restored or wrote back was minted since, and is taken
  whatever its expiry. The task keeps a digest of the login it last
  stored on the volume, to tell the two apart.
- A login minted while the old one still works is taken at the next
  check, before any refresh of the old one can be written over it.
- After every CLI run, a credentials file that changed is checked and
  written back. A login the CLI broke is never stored.
- One CLI runs at a time, through one queue.
- While nothing else runs the CLI, the login is kept fresh: within 30
  minutes of expiry, claude auth status, then a one-line prompt.
- A login that cannot be used or refreshed is an error line, unless
  /tagalong/claude-login holds a usable login that expires later than
  the one on disk. Then the task takes that one, as at start, so a
  newly minted login is picked up within 10 minutes, with no restart.
- The CLI's org is named in CLAUDE_CODE_ORGANIZATION_UUID.

## Do not

- Use a setup-token or an API key: neither can start a cloud session.
- Share the login with a laptop or another service.
- Refresh the token by calling the OAuth endpoint directly: the CLI
  owns the login's format.

History: Set when the repo was made, October 2026, following podstow's
dispatcher. A newly minted login is picked up without a restart since
27 November 2026 (#105). A login minted while the old one still works
is taken, whatever its expiry, since 27 November 2026 (#118).
