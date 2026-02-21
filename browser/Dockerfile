# Isolated Chromium browser container for OpenClaw
# Runs headless chromium with CDP exposed, completely isolated from the gateway container.

FROM debian:trixie-slim

ARG UID=1000
ARG GID=1000

RUN \
  DEBIAN_FRONTEND=noninteractive apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    procps \
    socat \
  && apt-get clean && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
  && getent group ${GID} >/dev/null || groupadd -g ${GID} chromium \
  && getent passwd ${UID} >/dev/null || useradd -m -u ${UID} -g ${GID} -s /bin/false chromium \
  && mkdir -p /home/chromium/user-data \
  && chown -R ${UID}:${GID} /home/chromium

USER ${UID}:${GID}

ENV HOME=/home/chromium
ENV CHROMIUM_USER_DATA=/home/chromium/user-data

WORKDIR /home/chromium

COPY --chown=${UID}:${GID} entrypoint.sh /entrypoint.sh

EXPOSE 18800

ENTRYPOINT ["/entrypoint.sh"]