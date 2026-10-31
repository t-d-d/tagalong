# The upload link's Lambda (attachments.md): tagalong's own TypeScript source,
# run on Lambda's Node 24 base image with no build step (types-and-lint.md).
# Built natively on the arm64 runner by scripts/deploy.sh, for LinkFunction in
# infra/app.cfn.yml. The base image puts the code in LAMBDA_TASK_ROOT.

FROM public.ecr.aws/lambda/nodejs:24@sha256:5cc37494661b4b8cad808eb78ce36737c9c96b6fcaf0b2af67c4df4f63aff0f9

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY service/ ./service/
COPY images/upload-link.js ./

ENV NODE_ENV=production \
  NODE_OPTIONS=--no-warnings=ExperimentalWarning

CMD ["upload-link.handler"]
