#!/bin/sh
# Entrypoint for isolated Chromium container
# - Clears stale profile locks before startup
# - Launches chromium with CDP on port 18800
# - Handles graceful shutdown

set -e

CDP_PORT="${CDP_PORT:-18800}"
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
  echo "[$(date -Iseconds)] shutting down chromium..."
  if [ -n "$CHROMIUM_PID" ]; then
    kill -TERM "$CHROMIUM_PID" 2>/dev/null || true
    # Wait up to 5s for graceful exit
    for i in 1 2 3 4 5; do
      if ! kill -0 "$CHROMIUM_PID" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    # Force kill if still running
    kill -KILL "$CHROMIUM_PID" 2>/dev/null || true
  fi
  exit 0
}

trap cleanup TERM INT

# Main startup
clear_stale_locks

echo "[$(date -Iseconds)] starting chromium on CDP port $CDP_PORT..."

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
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port="$CDP_PORT" \
  --user-data-dir="$USER_DATA" \
  about:blank