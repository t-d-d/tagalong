# Alerting
Relevance: Alarms, metric filters, the alert topic, or the heartbeat: infra/app.cfn.yml, the heartbeat in service/src/app.ts
Decision: Three alarms email the owner through one topic: error lines, no connected heartbeat for 15 minutes, and spend.

Why: Nobody watches the logs. An error line means someone should look
now, a silent bridge means the group gets no answers, and the bill is
the last net for a runaway.

## Rules

- A metric filter counts error-level lines. The error-lines alarm fires
  on any in a minute.
- A metric filter counts heartbeat lines whose bridge is connected. The
  no-heartbeat alarm fires when there is none in 15 minutes, and
  missing data counts as none. It covers a stopped task, a crash loop,
  a logged-out device and a bridge that cannot reach WhatsApp.
- The spend alarm reads the account's bill against
  /tagalong/alerts/monthly-spend.
- Alerts go to the address in /tagalong/alerts/email.
- A dead login is an error line, so it alerts (claude-login.md).

## Do not

- Alarm on warnings: they are reviewed, not paged.
- Add a paid monitoring service.
- Alarm on Spot interruptions: the task comes back within the
  heartbeat's window, and the heartbeat says if it does not.

History: Set when the repo was made, October 2026, following spotimy.
