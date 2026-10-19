# Attachments
Relevance: Photos, files or voice notes passed to a session or sent back to the chat: service/src/attachments.ts, service/src/outgoing.ts, the bucket and its policy in infra/app.cfn.yml
Decision: Files pass both ways through a private bucket that deletes them after a day: to a session as hour-long links, back through a form for its turn.

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
- Each turn gets its own folder, outgoing/<random id>/, and a presigned
  POST form for it that lasts two hours and takes files of at most
  16 MB. Once the turn's answer is posted, at most five files from that
  folder go to the chat, each through the bridge's outbox, which is
  emptied as each is sent. Only the turn's own folder is read.
- File names, sizes and types never reach a log line; counts and bytes
  do. A transcript never reaches one; its length may.

## Do not

- Make the bucket or an object public.
- Put a file's contents in the prompt. A voice note's transcript is the
  one exception.
- Send audio outside the account to be transcribed.
- Give a session a way to write anywhere in the bucket but its turn's
  folder.
- Keep files past a day.

History: Set when the repo was made, October 2026. Voice notes are
transcribed since 19 October 2026, at the owner's request (#8). A
session's files are sent to the chat since the same day (#12).
