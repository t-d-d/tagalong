# Logging
Relevance: A log line, its level, its fields or its event name: service/** emissions, service/src/log.ts, the metric filters in infra/app.cfn.yml
Decision: Levels mean routing (error = alert, warn = review later, info = as designed); every line names an event; no message, number or name is logged.

Why: Levels chosen by feel drift until the error alarm means nothing,
and the groups are private conversations between people who did not
agree to have them kept in CloudWatch.

## Rules

- Every line is JSON, written by service/src/log.ts.
- Three levels, no debug. error = someone is alerted now. warn =
  handled but suspect. info = as designed, expected refusals included.
- Every line names an event from the one exported list in
  service/src/log.ts.
- No message text, phone number, LID, contact name or file name in any
  line. Group labels, Claude names, session ids, counts, statuses and
  lengths only. A one-to-one chat is labelled "direct chat", never by
  its number or name.
- Nothing at all is logged about a chat that is not set up.
- Log a dependency's error class and status, never its message.
- The heartbeat line names the bridge's state. The heartbeat alarm
  reads it (alerting.md).

## Do not

- Log content and scrub it afterwards.
- Log an expected refusal, such as a stranger's @claude, at warn or
  error.
- Add a debug level.

Judgment: Whether a line is error or warn is a judgement no check can
make. The integration tests check that no number, name or message they
send reaches a line.
History: Set when the repo was made, October 2026, following spotimy.
