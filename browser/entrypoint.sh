#!/bin/sh
# Entrypoint for isolated Chromium container
# - Clears stale profile locks before startup
# - Launches chromium with CDP on internal port
# - Uses socat to forward external port (chromium hardcodes 127.0.0.1 binding)
# - Handles graceful shutdown

set -e

CDP_PORT="${CDP_PORT:-18800}"
CDP_INTERNAL="${CDP_INTERNAL:-18801}"
USER_DATA="${CHROMIUM_USER_DATA:-/home/chromium/user-data}"
CHROMIUM_BIN="${CHROMIUM_BIN:-/usr/bin/chromium}"

# Clear stale lock files (left over from unclean shutdowns)
# These block chromium from starting with the same user-data dir
clear_stale_locks() {
  echo "[$(date -Iseconds)] clearing stale profile locks..."
  rm -f "$USER_DATA/SingletonLock" \
        "$USER_DATA/SingletonCookie" \
        "$USER_DATA/SingletonSocket" \
        "$USER_DATA/Default/SingletonLock" \
        "$USER_DATA/Default/SingletonCookie" \
        "$USER_DATA/Default/SingletonSocket" 2>/dev/null || true
}

# Cleanup function for graceful shutdown
cleanup() {
  echo "[$(date -Iseconds)] shutting down..."
  if [ -n "$CHROMIUM_PID" ]; then
    kill -TERM "$CHROMIUM_PID" 2>/dev/null || true
  fi
  if [ -n "$SOCAT_PID" ]; then
    kill -TERM "$SOCAT_PID" 2>/dev/null || true
  fi
  exit 0
}

trap cleanup TERM INT

# Main startup
clear_stale_locks

echo "[$(date -Iseconds)] starting socat proxy 0.0.0.0:$CDP_PORT -> 127.0.0.1:$CDP_INTERNAL..."
socat TCP-LISTEN:$CDP_PORT,reuseaddr,fork TCP:127.0.0.1:$CDP_INTERNAL &
SOCAT_PID=$!

echo "[$(date -Iseconds)] starting chromium on internal CDP port $CDP_INTERNAL..."

exec "$CHROMIUM_BIN" \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --disable-setuid-sandbox \
  --disable-dev-shm-usage \
  --no-first-run \
  --no-default-browser-check \
  --disable-sync \
  --disable-background-networking \
  --disable-component-update \
  --disable-features=Translate,MediaRouter \
  --disable-session-crashed-bubble \
  --hide-crash-restore-bubble \
  --password-store=basic \
  --disable-blink-features=AutomationControlled \
  --remote-debugging-port="$CDP_INTERNAL" \
  --user-data-dir="$USER_DATA" \
  about:blank