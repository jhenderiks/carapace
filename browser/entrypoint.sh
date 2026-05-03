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
HEADLESS="${BROWSER_HEADLESS:-1}"
ENABLE_NOVNC="${BROWSER_ENABLE_NOVNC:-0}"
VNC_PORT="${BROWSER_VNC_PORT:-5900}"
NOVNC_PORT="${BROWSER_NOVNC_PORT:-6080}"
NOVNC_PASSWORD="${BROWSER_NOVNC_PASSWORD:-}"
NOVNC_WEB_ROOT="${BROWSER_NOVNC_WEB_ROOT:-/tmp/novnc-web}"
NOVNC_NO_PASSWORD="${BROWSER_NOVNC_NO_PASSWORD:-0}"

truthy() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

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
  if [ -n "$WEBSOCKIFY_PID" ]; then
    kill -TERM "$WEBSOCKIFY_PID" 2>/dev/null || true
  fi
  if [ -n "$X11VNC_PID" ]; then
    kill -TERM "$X11VNC_PID" 2>/dev/null || true
  fi
  if [ -n "$XVFB_PID" ]; then
    kill -TERM "$XVFB_PID" 2>/dev/null || true
  fi
  exit 0
}

trap cleanup TERM INT

# Main startup
clear_stale_locks

CHROMIUM_ARGS=""

if truthy "$HEADLESS"; then
  CHROMIUM_ARGS="$CHROMIUM_ARGS --headless=new --disable-gpu"
else
  export DISPLAY=:1
  mkdir -p /tmp/.X11-unix
  Xvfb :1 -screen 0 1280x800x24 -ac -nolisten tcp &
  XVFB_PID=$!
  CHROMIUM_ARGS="$CHROMIUM_ARGS --disable-gpu"
fi

echo "[$(date -Iseconds)] starting socat proxy 0.0.0.0:$CDP_PORT -> 127.0.0.1:$CDP_INTERNAL..."
socat TCP-LISTEN:$CDP_PORT,reuseaddr,fork TCP:127.0.0.1:$CDP_INTERNAL &
SOCAT_PID=$!

if truthy "$ENABLE_NOVNC" && ! truthy "$HEADLESS"; then
  if ! truthy "$NOVNC_NO_PASSWORD" && [ -z "$NOVNC_PASSWORD" ]; then
    NOVNC_PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 12)"
  fi
  rm -rf "$NOVNC_WEB_ROOT"
  mkdir -p "$NOVNC_WEB_ROOT"
  for path in app core include utils vendor defaults.json mandatory.json package.json vnc.html vnc_auto.html vnc_lite.html; do
    ln -sf "/usr/share/novnc/$path" "$NOVNC_WEB_ROOT/$path"
  done
  cat > "$NOVNC_WEB_ROOT/index.html" <<EOF
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=/vnc.html?autoconnect=1&resize=remote">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenClaw Browser</title>
</head>
<body>
  <p>Opening browser session...</p>
  <script>
    window.location.replace('/vnc.html?autoconnect=1&resize=remote')
  <\/script>
</body>
</html>
EOF
  if truthy "$NOVNC_NO_PASSWORD"; then
    x11vnc -display :1 -rfbport "$VNC_PORT" -shared -forever -nopw -localhost &
  else
    x11vnc -storepasswd "$NOVNC_PASSWORD" /home/chromium/.vnc/passwd >/dev/null
    x11vnc -display :1 -rfbport "$VNC_PORT" -shared -forever -rfbauth /home/chromium/.vnc/passwd -localhost &
  fi
  X11VNC_PID=$!
  websockify --web "$NOVNC_WEB_ROOT" "$NOVNC_PORT" "localhost:$VNC_PORT" &
  WEBSOCKIFY_PID=$!
  echo "PORT=$VNC_PORT"
fi

echo "[$(date -Iseconds)] starting chromium on internal CDP port $CDP_INTERNAL..."

# shellcheck disable=SC2086
exec "$CHROMIUM_BIN" \
  $CHROMIUM_ARGS \
  --no-sandbox \
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
