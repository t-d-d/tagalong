# Repo and delivery
Relevance: Branch rules, CI, deploys, the stacks or repo layout: .github/workflows/**, infra/**, images/**, scripts/deploy.sh, the gate command, repository settings
Decision: One public repo; main changes by pull request; a green merge to main deploys to the one AWS account, and a failed live check puts back live-ok.

Why: Agents write most of the code and one person owns it, so the gate
on each pull request stands in for a second reviewer, and what runs is
always what main says.

## Rules

- All code, the stacks, the images and the docs live in this repo.
- The rules in force are in docs/constraints/. Decisions and their
  reasons live in issues.
- No direct pushes to main. Every change is a pull request.
- One command, npm run gate, runs the whole gate, locally and in CI.
- CI and deploys run on GitHub Actions, standard hosted runners only.
  The images are built on the arm64 runner, natively.
- A green merge to main deploys, through scripts/deploy.sh. Nothing
  else deploys, except the same run putting back the commit tagged
  live-ok when the deploy or its live check fails.
- The live check passes when the new task writes a heartbeat line.
- CI reaches AWS through GitHub's OIDC provider and the role in
  infra/github-oidc.cfn.yml, which only a job on main can assume. The
  repo holds no AWS keys and no secrets.
- An image's tag is a hash of the files it is built from, so an
  unchanged image is not rebuilt and a rollback reuses the old one.
- Every action, base image and tool a build fetches is pinned: actions
  by commit, images by digest, the bridge by commit, the CLI by version.

## Do not

- Deploy from a laptop: what is live drifts from main.
- Add a second environment: there is one WhatsApp device to run.
- Add a self-hosted runner: a public repo should not run pull request
  code on a personal machine.
- Tag images latest: a rollback must name the image it puts back.

History: Set when the repo was made, October 2026, following spotimy.
