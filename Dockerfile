ARG RTK_VERSION=v0.27.2
ARG RTK_IMAGE=rtk-local

FROM rust:bookworm AS rtk-local-build
ARG RTK_VERSION
RUN cargo install --git https://github.com/rtk-ai/rtk --tag ${RTK_VERSION}

# minimal stage to hold rtk artifacts for local fallback (when no RTK_IMAGE is set)
FROM scratch AS rtk-local
COPY --from=rtk-local-build /usr/local/cargo/bin/rtk /usr/local/bin/rtk
COPY rtk /opt/rtk

FROM ${RTK_IMAGE} AS rtk

FROM node:24-bookworm-slim

EXPOSE 18789

RUN \
  DEBIAN_FRONTEND=noninteractive apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get install -y --no-install-recommends \
    bash \
    bat \
    coreutils \
    fd-find \
    ffmpeg \
    fzf \
    g++ \
    gh \
    git \
    imagemagick \
    jq \
    make \
    openssh-client \
    python-is-python3 \
    python3 \
    python3-pip \
    ripgrep \
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

ARG APP=/opt/openclaw
ARG HOME=/home/openclaw

RUN \
  ARCH="$(dpkg --print-architecture | sed 's/arm64/aarch64/' | sed 's/amd64/x86_64/')" \
  # apt housekeeping
  && apt-get clean && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
  # install yt-dlp (youtube transcript/media extraction)
  && pip install --break-system-packages yt-dlp \
  # install bun
  && npm i -g bun npm \
  # symlink fdfind to fd
  && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
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
  # set home directory
  && usermod -d ${HOME} node \
  # create directories
  && mkdir -p ${APP} ${HOME} \
  # set ownership
  && chown -R node: ${APP} ${HOME}

USER node

ENV HOME=${HOME}
ENV PATH=${APP}/node_modules/.bin:/usr/lib/cargo/bin:$PATH

ENV OPENCLAW_STATE_DIR=${HOME}/.openclaw
ENV OPENCLAW_WORKSPACE_DIR=${OPENCLAW_STATE_DIR}/workspace

COPY --from=astral/uv:0.10.5 /uv /uvx /usr/local/bin/
COPY --from=rtk /usr/local/bin/rtk /usr/local/bin/rtk
COPY --from=rtk /opt/rtk /opt/rtk

WORKDIR ${APP}

COPY --chown=node: bun.lock package.json ./
COPY --chown=node: patches patches
COPY --chown=node: plugins plugins

RUN bun i --frozen-lockfile --backend=copyfile \
  # OpenClaw blocks world-writable plugin files; normalize modes after install
  && find ${APP}/node_modules/openclaw/dist/extensions -type d -exec chmod 755 {} + \
  && find ${APP}/node_modules/openclaw/dist/extensions -type f -exec chmod 644 {} +

ENTRYPOINT ["openclaw"]
