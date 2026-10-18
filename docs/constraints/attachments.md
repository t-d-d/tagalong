# Attachments
Relevance: Photos, files or voice notes passed to a session: service/src/attachments.ts, the bucket and its policy in infra/app.cfn.yml
Decision: A member's recent files reach a session as S3 links that last an hour, from a private bucket that deletes them after a day.

Why: A cloud session cannot reach the bridge, but its environment can
fetch from *.amazonaws.com. A short link gives it the one file and
nothing else.

## Rules

- A request carries the media in its own message, the message it
  replies to, and any a member sent in the last ten minutes that no
  session has had yet. At most five, each at most 25 MB.
- Only media from owners and members is passed on.
- The bridge downloads each into its store. tagalong uploads it to
  attachments/<random id>/<safe name> and gives the session a presigned
  GET link valid for an hour.
- The bucket blocks public access and expires every object after a day.
- File names, sizes and types never reach a log line; counts and bytes
  do.

## Do not

- Make the bucket or an object public.
- Put a file's contents in the prompt.
- Keep files past a day.

History: Set when the repo was made, October 2026.
