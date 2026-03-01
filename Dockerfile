ARG RTK_VERSION=v0.23.0

FROM rust:bookworm AS rtk-local-build
ARG RTK_VERSION
RUN cargo install --git https://github.com/rtk-ai/rtk --tag ${RTK_VERSION}

FROM scratch AS rtk-local
COPY --from=rtk-local-build /usr/local/cargo/bin/rtk /usr/local/bin/rtk
COPY rtk /opt/rtk

ARG RTK_IMAGE=rtk-local
FROM ${RTK_IMAGE} AS rtk

FROM platformatic/node-caged:slim

EXPOSE 18789

RUN \
  DEBIAN_FRONTEND=noninteractive apt-get update \
  && apt-get install -y --no-install-recommends \
    bat \
    ca-certificates \
    curl \
    fd-find \
    ffmpeg \
    fzf \
    g++ \
    git \
    gh \
    imagemagick \
    jq \
    make \
    python-is-python3 \
    python3 \
    python3-pip \
    ripgrep \
    ssh \
    trash-cli \
    unzip \
    wget

# investigation / network-debug tools (only enable when needed)
# RUN \
#   DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
#     dnsutils \
#     iproute2 \
#     iputils-ping \
#     net-tools \
#     netcat-openbsd \
#     nmap \
#     traceroute

# install rtk
COPY --from=rtk /usr/local/bin/rtk /usr/local/bin/rtk
# install uv
COPY --from=astral/uv:0.10.5 /uv /uvx /usr/local/bin/

ARG UID=1000
ARG GID=1000

ARG APP=/opt/openclaw
ARG HOME=/home/openclaw

RUN \
  ARCH="$(dpkg --print-architecture | sed 's/arm64/aarch64/' | sed 's/amd64/x86_64/')" \
  # apt housekeeping
  && apt-get clean && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
  # install yt-dlp (youtube transcript/media extraction)
  && pip install --break-system-packages yt-dlp \
  # install bun
  && npm i -g bun \
  # install eza
  && wget -qO /tmp/eza.tar.gz "https://github.com/eza-community/eza/releases/latest/download/eza_${ARCH}-unknown-linux-gnu.tar.gz" \
  && tar -xzf /tmp/eza.tar.gz -C /usr/local/bin/ \
  && rm /tmp/eza.tar.gz \
  # fix sqlite-vec linking issue
  && SQLITE_ARCH="$(dpkg --print-architecture | sed 's/amd64/x64/')" \
  && mkdir -p /usr/local/lib/sqlite-vec \
  && ln -s ${APP}/node_modules/sqlite-vec-linux-${SQLITE_ARCH}/vec0.so /usr/local/lib/sqlite-vec/vec0.so \
  # symlink bat (bookworm packages as batcat)
  && ln -s /usr/bin/batcat /usr/local/bin/bat \
  # add user & group if not exists
  && getent group ${GID} >/dev/null || groupadd -g ${GID} openclaw \
  && getent passwd ${UID} >/dev/null || useradd -m -u ${UID} -g ${GID} openclaw \
  # set home directory
  && usermod -d ${HOME} $(id -un ${UID}) \
  # create directories
  && mkdir -p ${APP} ${HOME} \
  # set ownership
  && chown -R ${UID}:${GID} ${APP} ${HOME}

USER ${UID}:${GID}

ENV HOME=${HOME}
ENV PATH=${APP}/node_modules/.bin:/usr/lib/cargo/bin:$PATH

ENV OPENCLAW_STATE_DIR=${HOME}/.openclaw
ENV OPENCLAW_WORKSPACE_DIR=${OPENCLAW_STATE_DIR}/workspace

WORKDIR ${APP}

COPY --chown=${UID}:${GID} bun.lock package.json .
COPY --chown=${UID}:${GID} patches patches
COPY --from=rtk --chown=${UID}:${GID} /opt/rtk /opt/rtk

RUN bun i --frozen-lockfile \
  # OpenClaw blocks world-writable plugin files; normalize modes after install
  && find ${APP}/node_modules/openclaw/extensions -type d -exec chmod 755 {} + \
  && find ${APP}/node_modules/openclaw/extensions -type f -exec chmod 644 {} +

ENTRYPOINT ["bun", "openclaw"]
