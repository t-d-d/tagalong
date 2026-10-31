# Attachments
Relevance: Photos, files or voice notes passed to a session or sent back to the chat: service/src/attachments.ts, service/src/outgoing.ts, service/src/upload-link.ts, the bucket, its policy and the upload link in infra/app.cfn.yml
Decision: Files pass both ways through a private bucket that deletes them after a day: to a session as hour-long links, back through each session's upload link.

Why: A cloud session cannot reach the bridge, but its environment can
fetch from *.amazonaws.com. A short link gives it the one file and
nothing else. Anything the task signs carries its role's session token,
so a signed upload form is about 3 KB a Claude must copy exactly. The
upload link is short, and a Lambda signs for it at the moment of use.

## Rules

- A request carries the media in its own message, the message it
  replies to, and any a member sent in the last ten minutes that no
  session has had yet. At most five, each at most 25 MB.
- An interjecting delivery carries media as a request does: what the
  people who may ask the Claude sent since it last heard, not yet given
  to it. At most five, each at most 25 MB.
- A file goes at least once to each Claude, not exactly once. It counts
  as given once its delivery reaches the session. One the bridge never
  hands over whole, whose upload fails, or whose delivery fails, is not
  counted, so a request in the next ten minutes, or the next try of a
  delivery that failed, offers it again. A send that fails
  without saying whether the session got it can give a file twice.
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
- Each session has one upload link, /up/<id>/ on the upload link's
  HTTP API, whose id is 24 random URL-safe characters. A Claude uploads
  with curl -fsS -T <path> "$(curl -fsS '<link><name>')". A session
  that carries on another's conversation keeps its link. @claude fresh
  starts a new one.
- The link goes in a session's first prompt, and again in a follow-up
  when the session last had it more than two hours earlier. Other
  follow-ups carry no upload line.
- tagalong writes an empty marker at links/<id> with every delivery.
  The upload link's Lambda answers GET /up/<id>/<name> with a
  five-minute presigned PUT URL for outgoing/<id>/<safe name> while
  the marker is less than two hours old, and with 404 otherwise. The
  task signs nothing for uploads.
- Once an answer is posted, at most five new files go to the chat from
  the session's folder, each at most 16 MB, each through the bridge's
  outbox, which is emptied as each is sent. Each file goes once. A PUT
  URL cannot cap a file's size, so a larger file can land. It is
  skipped, and the bucket deletes it within a day.
- The folder is read after every posted answer, even while another
  delivery to the session waits. A file uploaded for a queued ask in
  the seconds before tagalong reads the previous answer goes with that
  answer.
- File names, sizes and types never reach a log line; counts and bytes
  do. A transcript never reaches one; its length may. A link's id never
  reaches one.

## Do not

- Make the bucket or an object public.
- Put a file's contents in the prompt. A voice note's transcript is the
  one exception.
- Send audio outside the account to be transcribed.
- Give a session a way to write anywhere in the bucket but its own
  folder.
- Put a form or URL the task signed in a prompt for uploads: it carries
  the role's session token, which a Claude must copy exactly, in every
  message.
- Keep files past a day.

History: Set when the repo was made, October 2026. Voice notes are
transcribed since 19 October 2026, at the owner's request (#8). A
session's files are sent to the chat since the same day (#12). A turn
sends from the folder of each delivery it answers, each file once, since
27 October 2026 (#17). Each session has one short upload link, which a
Lambda turns into an upload URL, since 31 October 2026, at the owner's
request (#59). An interjecting delivery carries media as a request does
since 31 October 2026, at the owner's request (#81). A file counts as given
only once it reaches the session since 31 October 2026 (#83), and goes
at least once, not exactly once, at the owner's choice (#91).
