# 🐚 Carapace

A hardened Docker container for running [OpenClaw](https://github.com/openclaw/openclaw) — the AI agent gateway.

Carapace wraps OpenClaw in a security-focused container with sensible defaults: read-only root filesystem, dropped capabilities, no-new-privileges, pid limits, and a non-root user. The container is mostly ephemeral — only two directories persist across restarts: `config/` (OpenClaw state) and `workspace/` (agent identity, memory, and skills). Everything else resets on restart.

## Contents

- [Why?](#why)
- [Included Tools](#included-tools)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Customization](#customization)
  - [UID/GID and Permissions](#uidgid-and-permissions)
  - [Architecture (sqlite-vec)](#architecture-sqlite-vec)
  - [Adding Tools](#adding-tools)
  - [Extending the Compose](#extending-the-compose)
  - [Additional Home Directory Mounts](#additional-home-directory-mounts)
  - [Named Network](#named-network)
  - [Versioning Your Workspace](#versioning-your-workspace)
  - [RTK Token Compression](#rtk-token-compression)
- [Security Model](#security-model)
- [Patches](#patches)
- [License](#license)

## Why?

OpenClaw runs an AI agent with access to shell commands, files, and external services. That's powerful — and risky. Carapace adds a layer of defense:

- **Read-only root filesystem** — the container can't modify its own binaries
- **All capabilities dropped** — no privilege escalation paths
- **Non-root user** — the agent process has minimal system access
- **PID limits** — prevents fork bombs
- **tmpfs home directory** — 2GB ephemeral home (noexec, nosuid), nothing persists across restarts unless explicitly mounted
- **tmpfs for /tmp** — ephemeral scratch space, size-limited
- **No new privileges** — prevents setuid/setgid abuse

It's not a sandbox (the agent still has network access and can write to mounted volumes), but it significantly reduces the blast radius.

## Included Tools

The container image includes:

| Category | Tools |
|---|---|
| **Shell** | bat, eza, fd-find, fzf, jq, ripgrep |
| **Media** | ffmpeg, imagemagick, yt-dlp |
| **Dev** | git, gh (GitHub CLI), ssh, python3, bun, typescript |
| **Network** | curl, wget |
| **Token Optimization** | [rtk](https://github.com/rtk-ai/rtk) (with selective shell wrappers) |
| **System** | trash-cli, unzip |

### Optional: Isolated Browser Container

Carapace includes an optional isolated browser container (`browser/`) that runs Chromium in a separate container with:

- **Network isolation** — only CDP port exposed to gateway container
- **No access to gateway config** — browser can't read OpenClaw config, credentials, or workspace
- **Read-only root filesystem** — prevents persistent malware installation
- **Memory limits** — prevents runaway processes
- **Stale lock cleanup** — automatically clears `SingletonLock`/`SingletonCookie`/`SingletonSocket` on startup

The browser container starts automatically with `docker compose up`. Configure OpenClaw to use it by setting the CDP URL in your config:

```json
{
  "browser": {
    "enabled": true,
    "profiles": {
      "openclaw": {
        "cdpUrl": "http://172.20.0.10:18800"
      }
    },
    "defaultProfile": "openclaw"
  }
}
```

Note: The browser container is assigned a static IP (`172.20.0.10`) because Chromium's DevTools protocol rejects hostname-based `Host` headers for security reasons. Only IP addresses or `localhost` are accepted.

**Why isolate the browser?** Chromium runs with `--no-sandbox` in containers, and CDP has no authentication. Without isolation, a compromised browser process or malicious CDP client can access the gateway's config, credentials, and workspace. The isolated container limits the blast radius to just the browser's own user-data directory.

## Quick Start

### Prerequisites

- Docker + Docker Compose
- [Bun](https://bun.sh) (for dependency management)

### Setup

```bash
# Clone the repo
git clone https://github.com/jhenderiks/carapace.git
cd carapace

# Install dependencies (builds the lockfile and patches)
bun install

# Create your environment file
cp .env.example .env
# Edit .env with your API keys and tokens

# Run the interactive setup wizard
bun run setup

# Build and start
docker compose up
```

### First Run

On first boot, OpenClaw will generate a QR code for pairing. Check the logs:

```bash
docker compose logs -f gateway
```

Scan the QR code with your messaging app to connect.

### CLI Access

Need to run OpenClaw CLI commands inside the container?

```bash
bun run cli
# or: docker compose run --rm cli
```

## Architecture

### Persistent State

Two directories survive container restarts via bind mounts:

| Host Path | Container Path | Purpose |
|---|---|---|
| `./config` | `/home/openclaw/.openclaw` | OpenClaw state — config, sessions, agent metadata |
| `./workspace` | `/home/openclaw/.openclaw/workspace` | Agent workspace — identity (`SOUL.md`), `memory/`, `skills/`, tasks, etc. |

Everything else under `/home/openclaw` is a 2GB tmpfs — it resets on restart. This includes SSH keys, git config, and tool state unless you explicitly bind-mount them (see [Additional Home Directory Mounts](#additional-home-directory-mounts)).

### Services

- **gateway** — the main OpenClaw process. Runs the agent, connects to messaging channels, serves the gateway API on port 18789.
- **cli** — an ephemeral container for running `openclaw` CLI commands. Shares the network with the gateway and mounts the config directory.

## Customization

### UID/GID and Permissions

The default container user is `1000:1000`. If you hit permission errors on mounted volumes, it's usually a UID/GID mismatch. Set the build args to match your host user:

```yaml
# docker-compose.override.yml
services:
  gateway:
    build:
      args:
        UID: 1000  # your host UID (run `id -u`)
        GID: 1000  # your host GID (run `id -g`)
```

Then rebuild: `docker compose build`

### Architecture (sqlite-vec)

The image symlinks the platform-specific `sqlite-vec` native extension at build time using Docker's built-in `TARGETARCH` argument (`amd64` → `x64`, `arm64` → `arm64`). Multi-platform builds work without any extra configuration.

### Adding Tools

Uncomment or add packages in the Dockerfile's `apt-get install` block. Network debug tools (nmap, traceroute, etc.) are listed but commented out.

### Extending the Compose

You can layer additional configuration on top of the base `docker-compose.yml` without modifying it directly — keeping your personal config separate and upgradeable.

**Option 1: Override file** (simplest)

Create a `docker-compose.override.yml` in the same directory. Docker Compose automatically merges it at runtime:

```yaml
# docker-compose.override.yml
services:
  gateway:
    volumes:
      - ~/.ssh:/home/openclaw/.ssh:rw
      - ~/.gitconfig:/home/openclaw/.gitconfig:rw
```

**Option 2: Parent compose with `include`**

For more complex setups (companion services, custom networks, multiple mounts), create a parent compose that includes carapace as a base:

```yaml
# ~/my-setup/docker-compose.yml
include:
  - carapace/docker-compose.yml

services:
  gateway:
    volumes:
      - ./my-config:/home/openclaw/.openclaw:rw
      - ./my-workspace:/home/openclaw/.openclaw/workspace:rw
```

Both approaches let you keep carapace as a clean upstream you can `git pull` and update independently.

### Additional Home Directory Mounts

The base compose leaves most of `/home/openclaw` as ephemeral tmpfs — it resets on container restart. For a more persistent setup, you can bind-mount directories from your host:

| Mount | Purpose |
|---|---|
| `~/.ssh:/home/openclaw/.ssh:rw` | SSH keys for git, remote access |
| `~/.gitconfig:/home/openclaw/.gitconfig:rw` | Git identity and config |
| `~/.node-llama-cpp:/home/openclaw/.node-llama-cpp:rw` | Local LLM model files |
| `./rtk-data:/home/openclaw/.local/share/rtk:rw` | rtk token savings history (optional) |
| `/your/path:/mnt:rw` | Persistent workspace volume for repos, data, etc. |

These are all optional — only add what your use case actually needs.

### Named Network

By default, Carapace uses Docker's default bridge network. If you want the gateway reachable by other containers (e.g., a reverse proxy or companion services), define a named network via an override:

```yaml
# docker-compose.override.yml
networks:
  carapace:
    name: carapace
    ipam:
      config:
        - subnet: 172.20.0.0/16

services:
  gateway:
    networks:
      - carapace
```

### Versioning Your Workspace

Your agent's `config/` and `workspace/` directories hold its identity, memory, skills, and settings — worth treating like code.

Consider keeping them in a dedicated git repository separate from carapace, then mounting from there instead of `./config` and `./workspace`. This lets you version and restore your agent's state independently of the container setup, and pull carapace updates without touching your personal config.

How you structure this is entirely up to you — the mounts are just directories.

### RTK Token Compression

[rtk](https://github.com/rtk-ai/rtk) is a CLI proxy that compresses shell command output before it reaches the LLM context, reducing token usage by 40-90% on common operations (git, ls, grep, etc.).

Carapace ships a companion RTK image (`ghcr.io/jhenderiks/carapace-rtk`) built from `Dockerfile.rtk`. That image contains:

- the `rtk` binary (currently v0.27.2)
- thin wrapper scripts from `rtk/` (mounted in the gateway image at `/opt/rtk`)

The gateway image copies those artifacts during build (`ARG RTK_IMAGE=...`) so other projects can reuse the exact same RTK package without recompiling Rust or duplicating wrappers.

To build against a custom RTK image locally:

```bash
# build the RTK companion image
docker build -f Dockerfile.rtk -t ghcr.io/jhenderiks/carapace-rtk:latest .

# build gateway/cli using that image
RTK_IMAGE=ghcr.io/jhenderiks/carapace-rtk:latest docker compose build
```

If `RTK_IMAGE` is omitted, the Dockerfile falls back to a local `rtk-local` build stage and compiles rtk from source.

When OpenClaw's `tools.exec.pathPrepend` config points at `/opt/rtk`, agent-initiated commands are transparently routed through rtk — the LLM only ever sees compressed output.

**How it works:**

1. OpenClaw prepends `/opt/rtk` to `PATH` for `exec` tool calls only (not the container's global `PATH`)
2. Each wrapper script delegates rewrite decisions to upstream `rtk rewrite`
3. Unrecognized subcommands/flags pass through to the real binary

**Common mappings:**

| Command | Routes to | Why |
|---|---|---|
| `cat file` | `rtk read file` | rtk's file reader with intelligent filtering |
| `rg pattern` | `rtk grep pattern` | ripgrep → rtk's compact grep |
| `eslint` | `rtk lint` | rtk's lint formatter |
| `head -N file` | `rtk read file --max-lines N` | Only when a file arg is present (piped `head` passes through) |
| `mypy` | `rtk mypy` | Grouped type-check output |
| `aws sts get-caller-identity` | `rtk aws sts get-caller-identity` | AWS CLI output formatter |
| `psql -c 'select 1'` | `rtk psql -c 'select 1'` | SQL output formatter |

**Configuration** — add the following to your OpenClaw config and restart the gateway:

```json
{
  "tools": {
    "exec": {
      "pathPrepend": ["/opt/rtk"]
    }
  }
}
```

**Why `pathPrepend` instead of container `PATH`?** `pathPrepend` only affects agent-initiated `exec` tool calls. Container-internal processes (OpenClaw itself, git hooks, npm scripts) still use the real binaries. This avoids subtle breakage in non-LLM contexts where compressed output would be wrong.

**Tracking savings:** rtk records token savings in a SQLite database at `~/.local/share/rtk/history.db`. Run `rtk gain` inside the container to see cumulative stats, or `rtk gain --graph` for a daily breakdown. To persist this across restarts, bind-mount the directory (e.g., `./rtk-data:/home/openclaw/.local/share/rtk:rw`).

**RTK config:** rtk reads its own config file for hook exclusions and telemetry:

```toml
[hooks]
exclude_commands = ["curl", "playwright"]

[telemetry]
enabled = false
```

## Security Model

**What Carapace protects against:**
- Container escape via privilege escalation
- Persistent rootkit installation (read-only root)
- Resource exhaustion (pid limits, tmpfs size limits)
- Accidental system modification
- Persistent state leakage (tmpfs home wipes on restart)
- Browser compromise spreading to gateway (when using isolated browser container)

**What Carapace does NOT protect against:**
- Network-based attacks (the agent has full network access)
- Data exfiltration via mounted volumes
- Malicious actions within the agent's granted permissions

**Browser security:**

If you choose to run Chromium directly in the gateway container (custom image), note the risks:
- A compromised browser page can escape to the gateway container
- CDP (port 18800) has no authentication — any process in the container can control the browser
- The browser would run with access to gateway config and credentials

Carapace's default setup uses the isolated `browser` container to reduce that risk:
- Browser runs in a separate container with no access to `~/.openclaw`
- Only CDP port is exposed to the gateway container
- Memory limits prevent runaway processes
- Compromised browser ≠ compromised gateway

Carapace is defense-in-depth, not a sandbox. It reduces risk — it doesn't eliminate it. Always review your agent's capabilities and limit API key permissions where possible.

## Patches

Carapace may ship patches for upstream dependencies when fixes haven't been released yet. Current patches:

| Package | Patch file | Fix | Upstream |
|---|---|---|---|
| `openclaw@2026.2.25` | `patches/openclaw@2026.2.25.patch` | Mattermost inbound file attachments silently dropped when `baseUrl` is a private/LAN IP — adds `ssrfPolicy: { allowPrivateNetwork: true }` to `fetchRemoteMedia()` | [#25650](https://github.com/openclaw/openclaw/issues/25650), [#19396](https://github.com/openclaw/openclaw/issues/19396) |

These are applied automatically by Bun during `bun install`. When upstream releases include the fixes, the patches will be removed.

## License

[MIT](LICENSE)
