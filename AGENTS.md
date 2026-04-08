# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-08
**Commit:** 2dbe8e4
**Branch:** chore/upgrade-openclaw

## OVERVIEW

Carapace is a security-hardened Docker container for running [OpenClaw](https://github.com/openclaw/openclaw) (AI agent gateway). TypeScript plugins extend the gateway with MCP bridging, RTK token compression, and context-mode search. Bun manages dependencies; no build step (noEmit tsconfig for type-checking only).

## STRUCTURE

```
carapace/
├── plugins/          # OpenClaw TypeScript plugins (3 packages)
│   ├── mcp-bridge/   # MCP stdio server → OpenClaw tool bridge
│   ├── rtk-rewrite/  # exec hook: rewrites commands through rtk
│   └── context-mode/ # Spawns context-mode MCP, registers cm_* tools
├── rtk/              # 37 thin shell wrappers (cat→rtk read, rg→rtk grep, etc.)
├── browser/          # Isolated Chromium container (Dockerfile + entrypoint.sh)
├── workspace/        # Agent workspace (SOUL.md, memory/, skills/) — mounted volume
├── config/           # OpenClaw state — mounted volume, not in git
├── patches/          # Bun patches for upstream deps
└── .github/workflows/  # CI (typecheck) + container image build (multi-arch)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add/modify a plugin | `plugins/{name}/src/` | Each plugin has own package.json + openclaw.plugin.json |
| Plugin entry point | `plugins/{name}/index.ts` | Re-exports from `./src/handler.js` |
| RTK command mappings | `rtk/` + `plugins/rtk-rewrite/src/routing.ts` | Wrappers are legacy; plugin does the routing now |
| Docker build | `Dockerfile` | node:24-bookworm-slim, copies rtk binary from companion image |
| Container security | `docker-compose.yml` | read_only, cap_drop ALL, tmpfs, pid limits |
| Browser isolation | `browser/` | Separate container, static IP 172.20.0.10 for CDP |
| CI/CD | `.github/workflows/` | ci.yml (typecheck), container-image.yml (multi-arch GHCR) |
| Agent identity | `workspace/SOUL.md` | Mounted into container at runtime |
| Upstream patches | `patches/` | Auto-applied by `bun install` |

## CONVENTIONS

- **No workspaces**: Manual monorepo — plugins are separate packages without npm/bun workspace linking
- **No linter/formatter config**: No eslint, prettier, or editorconfig. Relies on defaults
- **noEmit TypeScript**: tsconfig exists for type-checking only (`bun run tsc`), no compile step
- **Plugin pattern**: Each plugin exports a default handler from `src/handler.ts` via `index.ts`. Config defined in `openclaw.plugin.json`
- **ESM only**: `"type": "module"` in root, `NodeNext` module resolution
- **Tests co-located**: `*.test.ts` files sit next to source in `src/`. Node.js built-in `assert`, no test framework
- **Nix dev shell**: `flake.nix` provides dev environment (alternative to nvm/volta)

## ANTI-PATTERNS (THIS PROJECT)

- **Never use both RTK modes**: Use `rtk-rewrite` plugin OR `tools.exec.pathPrepend` — never both
- **Never enable `cm_ctx_execute`/`cm_ctx_batch_execute`**: Disabled by default to enforce exec→rtk split
- **Never run Chromium in gateway container**: Use the isolated `browser` service instead
- **Don't touch `workspace/AGENTS.md`**: That file is the agent's runtime workspace config, not project docs

## UNIQUE STYLES

- Plugins use a custom `"openclaw"` field in package.json for extension metadata
- RTK companion image built separately (`Dockerfile.rtk`), artifacts copied via multi-stage build
- Container uses tmpfs home (2GB, noexec) — only `config/` and `workspace/` persist
- XDG paths hardcoded to `/workspaces/arlo/.local/` to avoid state leakage into workdirs
- sqlite-vec native extension linked at build time via `TARGETARCH` detection

## COMMANDS

```bash
# Dev
bun install              # Install deps + apply patches
bun run tsc              # Type-check plugins (no build output)

# Docker
bun run build            # docker compose build
bun run up               # docker compose up
bun run cli              # docker compose run --rm cli
bun run logs             # docker compose logs -f gateway
bun run setup            # Interactive setup wizard
bun run down             # docker compose down

# Tests (no unified runner — run per-file)
bun run plugins/rtk-rewrite/src/routing.test.ts
bun run plugins/mcp-bridge/src/handler.test.ts
bun run plugins/context-mode/src/types.test.ts
```

## NOTES

- The `rtk/` directory (37 wrapper scripts) is the legacy PATH-prepend approach. The `rtk-rewrite` plugin supersedes it but wrappers remain for the companion Docker image
- `openclaw` binary comes from npm (`openclaw@2026.4.8`), not built from source
- Current patch: Mattermost websocket keepalive fix (upstream #44160)
- Browser container gets static IP (172.20.0.10) because CDP rejects hostname-based Host headers
- Container runs as `node` user (UID 1000) — mounted volumes must match ownership
