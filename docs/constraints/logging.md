# Logging
Relevance: A log line, its level, its fields or its event name: service/** emissions, service/src/log.ts, the bridge's lines and their filter in images/bridge-start.sh, the metric filters in infra/app.cfn.yml
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
- The rule on numbers and names holds for the bridge's lines too. The
  bridge is not ours to change, so every line it writes passes through
  the filter in images/bridge-start.sh before it reaches stdout. The
  filter masks JIDs, phone numbers, group ids, LIDs and the contact
  names in its chat-name lines, and keeps the rest of each line. It
  keeps only the bridge's lines about the connection, its warnings and
  its errors, because the bridge prints every message it sees. Each
  entry in its keep list is tied to the start of a line, so a word in
  the middle of a message cannot match it.

## Do not

- Log content and scrub it afterwards. The bridge's filter is the one
  exception, because the bridge's own code is not ours.
- Log an expected refusal, such as a stranger's @claude, at warn or
  error.
- Add a debug level.

Judgment: Whether a line is error or warn is a judgement no check can
make. The integration tests check that no number, name or message they
send reaches a line, and fitness/bridge-log.static.ts runs the bridge's
filter on lines shaped like the bridge's own.
History: Set when the repo was made, October 2026, following spotimy.
The rule covers the bridge's lines, masked by a filter, since 31
October 2026 (#14). Each entry in the bridge's keep list is tied to the
start of a line since 31 October 2026 (#53).
