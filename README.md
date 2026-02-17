# 🐚 Carapace

A hardened Docker container for running [OpenClaw](https://github.com/openclaw/openclaw) — the AI agent gateway.

Carapace wraps OpenClaw in a security-focused container with sensible defaults: read-only root filesystem, dropped capabilities, no-new-privileges, pid limits, and a non-root user. It includes common tools for agent workflows (ffmpeg, ripgrep, git, gh, imagemagick, yt-dlp, etc.) so your agent can actually get things done.

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

```
carapace/
├── Dockerfile          # Container image — Debian slim + tools + OpenClaw
├── docker-compose.yml  # Service definitions (gateway + cli)
├── package.json        # Dependencies (openclaw, coding agents)
├── patches/            # Upstream patches (see below)
├── .env.example        # Environment template
├── config/             # ← OpenClaw state (gitignored, created at runtime)
└── workspace/          # ← Agent workspace (gitignored, created at runtime)
```

### Container Mounts

| Host Path | Container Path | Purpose |
|---|---|---|
| `./config` | `/home/openclaw/.openclaw` | OpenClaw state directory (config, sessions, agents) |
| `./workspace` | `/home/openclaw/.openclaw/workspace` | Agent workspace (SOUL.md, memory/, skills/, etc.) |

The home directory (`/home/openclaw`) is a 2GB tmpfs — ephemeral across container restarts. Only `config/` and `workspace/` persist via bind mounts.

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

## Patches

Carapace may ship patches for upstream dependencies when fixes haven't been released yet. Current patches:

| Package | Why |
|---|---|
| `openclaw` | Discord guild message routing fix |
| `undici` | HTTP client fix |

These are applied automatically by Bun during `bun install`. When upstream releases include the fixes, the patches will be removed.

## Included Tools

The container image includes:

| Category | Tools |
|---|---|
| **Shell** | bat, eza, fd-find, fzf, jq, ripgrep |
| **Media** | ffmpeg, imagemagick, yt-dlp |
| **Dev** | git, gh (GitHub CLI), ssh, python3, bun, typescript |
| **Network** | curl, wget |
| **Browser** | chromium (headless) |
| **Coding Agents** | Claude Code, Codex, OpenCode |
| **System** | trash-cli, unzip |

## Security Model

**What Carapace protects against:**
- Container escape via privilege escalation
- Persistent rootkit installation (read-only root)
- Resource exhaustion (pid limits, tmpfs size limits)
- Accidental system modification
- Persistent state leakage (tmpfs home wipes on restart)

**What Carapace does NOT protect against:**
- Network-based attacks (the agent has full network access)
- Data exfiltration via mounted volumes
- Malicious actions within the agent's granted permissions

Carapace is defense-in-depth, not a sandbox. It reduces risk — it doesn't eliminate it. Always review your agent's capabilities and limit API key permissions where possible.

## License

[MIT](LICENSE)
