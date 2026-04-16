ARG RTK_IMAGE=carapace:rtk

FROM ${RTK_IMAGE} AS rtk-image

FROM node:24-bookworm-slim

EXPOSE 18789

RUN \
  DEBIAN_FRONTEND=noninteractive apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    jq \
    openssh-client \
    python-is-python3 \
    python3

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
  # apt housekeeping
  apt-get clean && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
  # install bun
  && npm i -g bun npm \
  # fix sqlite-vec linking issue
  && SQLITE_ARCH="$(dpkg --print-architecture | sed 's/amd64/x64/')" \
  && mkdir -p /usr/local/lib/sqlite-vec \
  && ln -s ${APP}/node_modules/sqlite-vec-linux-${SQLITE_ARCH}/vec0.so /usr/local/lib/sqlite-vec/vec0.so \
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

COPY --from=rtk-image /usr/local/bin/rtk /usr/local/bin/rtk

WORKDIR ${APP}

COPY --chown=node: bun.lock package.json ./
COPY --chown=node: patches patches
COPY --chown=node: plugins plugins

RUN --mount=type=cache,target=${HOME}/.bun,uid=1000 \
  # install dependencies
  bun i --frozen-lockfile \
  # install any missing runtime deps declared by bundled extensions
  && node ${APP}/node_modules/openclaw/scripts/postinstall-bundled-plugins.mjs \
  # Bundled extensions ship pre-installed node_modules inside
  # openclaw/dist/extensions/*/node_modules/. These deps need to be
  # resolvable from the package root, so symlink them into the top-level
  # node_modules (skip if already present to avoid clobbering).
  && for nm in ${APP}/node_modules/openclaw/dist/extensions/*/node_modules; do \
       [ -d "$nm" ] || continue; \
       for pkg in "$nm"/*; do \
         name=$(basename "$pkg"); \
         case "$name" in \
           @*) \
             mkdir -p "${APP}/node_modules/$name"; \
             for scoped in "$pkg"/*; do \
               [ -e "$scoped" ] || continue; \
               scoped_name=$(basename "$scoped"); \
               [ ! -e "${APP}/node_modules/$name/$scoped_name" ] && ln -s "$scoped" "${APP}/node_modules/$name/$scoped_name" || true; \
             done \
             ;; \
           .*) ;; \
           *) [ ! -e "${APP}/node_modules/$name" ] && ln -s "$pkg" "${APP}/node_modules/$name" || true ;; \
         esac; \
       done; \
     done \
  && chmod -R u=rwX,go=rX ${APP}/node_modules/openclaw/dist/extensions

ENTRYPOINT ["openclaw"]
