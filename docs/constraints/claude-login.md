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
  the volume already holds a newer one, which it writes back.
- After every CLI run, a credentials file that changed is checked and
  written back. A login the CLI broke is never stored.
- One CLI runs at a time, through one queue.
- While nothing else runs the CLI, the login is kept fresh: within 30
  minutes of expiry, claude auth status, then a one-line prompt.
- A login that cannot be used or refreshed is an error line.
- The CLI's org is named in CLAUDE_CODE_ORGANIZATION_UUID.

## Do not

- Use a setup-token or an API key: neither can start a cloud session.
- Share the login with a laptop or another service.
- Refresh the token by calling the OAuth endpoint directly: the CLI
  owns the login's format.

History: Set when the repo was made, October 2026, following podstow's
dispatcher.
