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
  - [Adding Tools](#adding-tools)
  - [Extending the Compose](#extending-the-compose)
  - [Additional Home Directory Mounts](#additional-home-directory-mounts)
  - [Named Network](#named-network)
  - [Versioning Your Workspace](#versioning-your-workspace)
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
| **Coding Agents** | Claude Code, Codex, OpenCode |
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
| `~/.codex:/home/openclaw/.codex:rw` | Codex agent configuration |
| `~/.node-llama-cpp:/home/openclaw/.node-llama-cpp:rw` | Local LLM model files |
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

### Browser Configuration

The browser container exposes Chromium's CDP on port 18800. The gateway connects to it via the `carapace` network.

**Default (in-gateway browser):**

```json
{
  "browser": {
    "enabled": true,
    "executablePath": "/usr/bin/chromium",
    "headless": true,
    "noSandbox": true,
    "defaultProfile": "openclaw"
  }
}
```

**Isolated browser container:**

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

The isolated browser automatically clears stale profile locks on startup, addressing the issue where unclean shutdowns leave `SingletonLock` files that block subsequent chromium launches.

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

By default, the gateway container runs Chromium directly with `--no-sandbox`. This means:
- A compromised browser page can escape to the container
- CDP (port 18800) has no authentication — any process in the container has full browser control
- The browser runs with access to all gateway config and credentials

The optional isolated browser container (`--profile browser`) addresses this:
- Browser runs in a separate container with no access to `~/.openclaw`
- Only CDP port is exposed to the gateway container
- Memory limits prevent runaway processes
- Compromised browser ≠ compromised gateway

Carapace is defense-in-depth, not a sandbox. It reduces risk — it doesn't eliminate it. Always review your agent's capabilities and limit API key permissions where possible.

## Patches

Carapace may ship patches for upstream dependencies when fixes haven't been released yet. Current patches:

| Package | Why |
|---|---|
| `openclaw` | Discord guild message routing fix |
| `undici` | HTTP client fix |

These are applied automatically by Bun during `bun install`. When upstream releases include the fixes, the patches will be removed.

## License

[MIT](LICENSE)
