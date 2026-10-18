# A public repo
Relevance: Any file that could hold a value: docs, tests, fakes, stacks, workflows, examples, groups.json examples, scripts/**
Decision: The repo is public, so it holds no phone number, group, account id, environment id, session id, login or address; those live in AWS.

Why: Anyone can read the repo. A phone number or group id is enough
to find the people in it, and an account or environment id is a
foothold.

## Rules

- Phone numbers in tests and docs come from Ofcom's drama range,
  447700900000 to 447700900999. Group and LID numbers start 120363000000.
- Environment ids in tests are env_fake followed by a word. Session ids
  in tests start 01Session.
- Owners, the alert address and the spend limit are Parameter Store
  values under /tagalong/. groups.json and state.json live on the
  volume, beside the device.
- The stacks take ids, subnets and images as parameters, and name AWS
  values by Parameter Store path, never by value.
- Repo variables hold the deploy role's ARN and the region. Nothing
  else is set in GitHub.
- fitness/public-repo.static.ts refuses any run of ten or more digits
  outside those ranges, and any env_ or session id that is not a fake.

## Do not

- Commit a real groups.json, state.json or log, even as an example.
- Write a value into a doc to save looking it up.

History: Set when the repo was made, October 2026.
