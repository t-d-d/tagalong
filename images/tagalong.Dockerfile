# tagalong: the service, the launcher and the Claude Code CLI it starts
# sessions with (cloud-sessions.md). Built natively on the arm64 runner by
# scripts/deploy.sh, for the tagalong container in infra/app.cfn.yml. Node
# runs the TypeScript source; there is no build step (types-and-lint.md).
#
# What it carries, and why each:
#   - python3: service/launch.py gives `claude --cloud` the terminal it needs.
#   - git: a session's workspace is a bare repo whose origin names the repo.
#   - tar: the device arrives as a tarball (one-device.md).
#   - the CLI, pinned, with its updater off: the launcher reads its output.

FROM public.ecr.aws/docker/library/node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 git ca-certificates tar \
  && rm -rf /var/lib/apt/lists/*

# The CLI's own install fetches its platform binary, so this one runs scripts.
RUN npm install -g @anthropic-ai/claude-code@2.1.302

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY service/ ./service/

# The node user is uid 1000, as the volume's access point makes every file.
USER node
ENV HOME=/data/home \
  NODE_ENV=production \
  DISABLE_AUTOUPDATER=1

CMD ["node", "--no-warnings=ExperimentalWarning", "service/src/main.ts"]
