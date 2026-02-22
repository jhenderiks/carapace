# Pin Node 22 on bullseye so @discordjs/opus can use prebuilt arm64 binaries
# (node 24 + glibc 2.41 falls back to source builds, which currently fail).
FROM node:22-bullseye-slim

EXPOSE 18789

RUN \
  DEBIAN_FRONTEND=noninteractive apt-get update \
  && apt-get install -y --no-install-recommends \
    bat \
    ca-certificates \
    chromium \
    curl \
    eza \
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

ARG UID=1000
ARG GID=1000

ARG APP=/opt/openclaw
ARG HOME=/home/openclaw

RUN \
  # apt housekeeping
  apt-get clean && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
  # install yt-dlp (youtube transcript/media extraction)
  && pip install --break-system-packages yt-dlp \
  # install bun
  && npm i -g bun \
  # fix sqlite-vec linking issue
  && mkdir -p /usr/local/lib/sqlite-vec \
  && ln -s ${APP}/node_modules/sqlite-vec-linux-x64/vec0.so /usr/local/lib/sqlite-vec/vec0.so \
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

RUN bun i --frozen-lockfile

ENTRYPOINT ["bun", "openclaw"]
