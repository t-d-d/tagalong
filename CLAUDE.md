# Working in this repo

tagalong puts Claude in WhatsApp groups: a linked WhatsApp device and a service beside it that starts Claude Code cloud sessions for `@claude` requests and posts their answers back.

- [docs/issue-workflow.md](docs/issue-workflow.md) says how tickets and PRDs are labelled, and when one is ready.
- [docs/constraints/](docs/constraints/README.md) holds the rules in force. Decisions and their reasons live in issues.

## Scope

- Build only what a ready ticket asks for. A new capability starts from a PRD, an issue labelled `type: prd`, that the owner has readied.
- Work you find in passing becomes an issue. Do not fix it in the branch you are on.

## Before any code edit

- Run the `constraints` skill. Config, the stacks, the images and `package.json` count as code.
- If the task conflicts with a constraint, stop and say so. Do not work around the rule, and do not quietly follow the task.
- A change to what a constraint means needs an issue the owner agrees to, linked from the file's History line.

## Tests first

- Write the failing test first. Watch it fail for the reason you expect, then write the code.
- A test's file name sets its tier ([test-tiers.md](docs/constraints/test-tiers.md)).

| Tier | File name | May touch |
| --- | --- | --- |
| Static | `*.static.ts` | The repo's own files, read only |
| Unit | `*.test.ts` | Memory only |
| Integration | `*.int.ts` | Loopback, temporary folders, and git, tar, python3 and stand-ins for claude run on them |

- An assertion goes in the lowest tier that can see it.
- A fitness function's describe name starts `fitness:` and names its constraint file.
- Never weaken or delete a test to get the gate green.

## The gate

- `npm run gate` runs everything: format, lint, types, and the static, unit and integration tests. It is the same command in CI.
- The gate is offline and holds no secrets.

## Branches and pull requests

- Never push to main. One branch per issue.
- Run the `pre-push` skill before every push. It ends by raising the pull request.
- The pull request body follows the `pr-description` skill.
- Nothing deploys except a green merge to main. Never deploy by hand.
- Governor's PR review merges a pull request that passes the `pr-review` checklist. One that fails waits for your edit or for the owner. One that changes a path on the human-only list in `.github/dispatch.json` waits for the owner. Do not merge your own pull request.

## Issues

- Read [docs/issue-workflow.md](docs/issue-workflow.md) before filing, labelling or triaging an issue.
- Given an issue number, run the `fetch-ticket` skill first.
- Governor starts a session on an issue labelled `workflow: ready for development` and `mode: afk` once none of its blockers is open, and claims it with `workflow: under development`. The session goes from the issue's text to a pull request without stopping to ask. A session that starts an issue any other way claims it itself.
- The review merges only a pull request whose issues are claimed and carry a `mode:` label. The one exception is a repair of a red deploy run on main, which closes no issue (test 2 of the `pr-review` checklist).
- A session labels the issues it files: a type, a mode, and ready once the spec is complete. It readies an enhancement only under a PRD the owner readied, and never moves a PRD's own `workflow:` label.
- Anything only the owner can do is not yours: a Parameter Store value, the device, the Claude login, an AWS or GitHub setting. Applying a label is not a setting. Say what is needed and stop.
- When your pull request has merged or closed, or you are done and have none, make the last line of your reply `Signing off.` or `Signing off: <reason>`. That archives the session. Do not sign off while the owner is working with you.

## GitHub from a cloud session

- Read the `github-tooling` skill before any `gh` command.
- A session has no cloud credentials and cannot read the AWS account. If a task needs a value, stop and say so.

## The repo is public

- No phone number, group, account, environment or session id goes in any file ([public-repo.md](docs/constraints/public-repo.md)). Tests use the fake ranges.
- No message text, number or name goes in a log line ([logging.md](docs/constraints/logging.md)).

## Writing

- Plain words and whole sentences. No em dashes.
- Run the `unslop` skill over anything a person will read: pull request bodies, issues, docs, the README, and what tagalong says in WhatsApp.
