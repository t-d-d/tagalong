# The WhatsApp bridge: verygoodplugins/whatsapp-mcp's Go bridge, built from a
# pinned commit (one-device.md). Built natively on the arm64 runner by
# scripts/deploy.sh, for the bridge container in infra/app.cfn.yml.

FROM public.ecr.aws/docker/library/golang:1.26-bookworm@sha256:d9c68c2c51161e12fd77e4c6320687c9cd86e1af1e3ad6e6cd63ff970641453c AS build

ARG BRIDGE_REPO=https://github.com/verygoodplugins/whatsapp-mcp.git
ARG BRIDGE_COMMIT=895404542017f34a900f9f572a5497c275a96440

RUN git init -q /src \
  && git -C /src fetch -q --depth 1 "$BRIDGE_REPO" "$BRIDGE_COMMIT" \
  && git -C /src checkout -q FETCH_HEAD \
  && test "$(git -C /src rev-parse HEAD)" = "$BRIDGE_COMMIT"

# One patch on that commit (one-device.md): a webhook for every media message,
# not only pictures, so a voice note that replies to an answer asks its Claude.
COPY images/bridge.patch /tmp/bridge.patch
RUN git -C /src apply /tmp/bridge.patch

WORKDIR /src/whatsapp-bridge
# go-sqlite3 needs cgo. go.sum pins every module.
RUN CGO_ENABLED=1 go build -trimpath -ldflags "-s -w" -o /out/whatsapp-bridge .

FROM public.ecr.aws/docker/library/debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/whatsapp-bridge /usr/local/bin/whatsapp-bridge
COPY images/bridge-start.sh /usr/local/bin/bridge-start

# The volume's access point makes every file uid and gid 1000 (hosting.md).
RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin bridge
USER 1000:1000

ENV WHATSAPP_MEDIA_ROOTS=/data/bridge/outbox

ENTRYPOINT ["/usr/local/bin/bridge-start"]
