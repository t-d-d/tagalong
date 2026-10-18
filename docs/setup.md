# Working on tagalong

How to run the checks, how to reach the running task, and what to do when an alert arrives. Making a deployment from nothing is in [bootstrap.md](bootstrap.md).

## The checks

Node 22.18 or later, and python3 for the launcher's tests.

```
npm ci
npm run gate
```

The gate is offline and needs no accounts ([test-tiers.md](constraints/test-tiers.md)).

## The operator's commands

The commands in [service/src/cli.ts](../service/src/cli.ts) run inside the task through ECS Exec. They need the AWS CLI and its Session Manager plugin.

```
task=$(aws ecs list-tasks --cluster tagalong --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster tagalong --task "$task" --container app \
  --interactive --command "npm run cli -- list-groups"
```

- `list-groups`: every group the device is in, ticked where tagalong is set up.
- `list-environments`: your cloud environments, by id and name.
- `probe <session id or link>`: a session's status, environment and last events.
- `add-group "<group name>" --repo owner/name [--access read-write] [--env <name or id>] [--ref <branch>] [--model <model>]` and `remove-group "<group name>"`: what `@claude setup` and `@claude stop` do, for when WhatsApp is not to hand. Restart the task afterwards.

To restart the task, which runs the same build again:

```
aws ecs update-service --cluster tagalong --service tagalong --force-new-deployment
```

## Reading the logs

Every line from tagalong is JSON in the log group `/tagalong`, under `app/`. The bridge's lines about its connection are under `bridge/`. In Logs Insights:

```
fields @timestamp, level, event, group, session, why
| filter level != "info"
| sort @timestamp desc
```

## When an alert arrives

- **tagalong-no-heartbeat**: read the last heartbeat's `bridge` field. `waiting-for-device` means no device has been moved yet. `disconnected` or `unreachable` means the bridge cannot reach WhatsApp: read the `bridge/` lines. If they say the device was logged out, pair a new one on a laptop (bootstrap.md, step 5), after removing the old store with ECS Exec: `rm -rf /data/bridge/store`, then restart the task. No lines at all means the task is not running: look at the service's events in the ECS console.
- **tagalong-error-lines** with `login-dead` or `login-missing`: mint a new login (bootstrap.md, step 2), then restart the task.
- **tagalong-error-lines** with `request-failed`: a session did not start. The line's `why` says what the launcher reported. Run `probe` on a session that did start to check the login and the environment.
- **tagalong-spend**: open Cost Explorer. One task should cost about $8 a month.

## Running it on a laptop

For trying a change against a real device, with the task stopped first (one bridge per device, [one-device.md](constraints/one-device.md)): run the bridge with `WEBHOOK_URL=http://127.0.0.1:8769/whatsapp/webhook`, then

```
BRIDGE_STORE=<the bridge's store> GROUPS_FILE=./groups.json \
  STATE_FILE=./state.json WORKSPACES_DIR=./workspaces DRY_RUN=1 npm start
```

With no `LOGIN_PARAMETER`, tagalong reads the laptop's own Claude login and stores nothing. `DRY_RUN=1` logs requests without starting sessions. Accept the folder-trust prompt once by running `claude` in the workspaces folder.
