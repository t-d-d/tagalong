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
- Each voice note is transcribed by Amazon Transcribe in the account.
  Its transcript goes beside it in the bucket, and the job is deleted
  once read. The session gets the transcript under the link, marked as
  speech recognition that may have errors. A note that fails or takes
  over a minute still goes, as a link alone.
- File names, sizes and types never reach a log line; counts and bytes
  do. A transcript never reaches one; its length may.

## Do not

- Make the bucket or an object public.
- Put a file's contents in the prompt. A voice note's transcript is the
  one exception.
- Send audio outside the account to be transcribed.
- Keep files past a day.

History: Set when the repo was made, October 2026. Voice notes are
transcribed since 19 October 2026, at the owner's request (#8).
