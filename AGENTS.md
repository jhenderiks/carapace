# PROJECT KNOWLEDGE BASE

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

## PATCHING MODELS

Model registrations live in `@mariozechner/pi-ai` (NOT `pi-coding-agent`). The built-in model list is at `node_modules/@mariozechner/pi-ai/dist/models.generated.js` — a giant JS object keyed by provider, then by model ID.

### Dependency chain

`openclaw` → `@mariozechner/pi-coding-agent` → `@mariozechner/pi-ai` (model definitions live here)

### How models are structured

Each provider has a block in the `MODELS` export. Example for `opencode-go`:

```js
"opencode-go": {
    "glm-5": { id: "glm-5", name: "GLM-5", api: "openai-completions", provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", ... },
    "kimi-k2.5": { ... },
    ...
},
```

A model entry needs: `id`, `name`, `api`, `provider`, `baseUrl`, `reasoning`, `input`, `cost` (input/output/cacheRead/cacheWrite), `contextWindow`, `maxTokens`. Some providers also need `headers` (e.g. github-copilot) or `compat` flags.

### To add a missing model

1. Find the target provider's existing entries in `models.generated.js` for the baseUrl, api, headers, and compat pattern
2. If the model exists under a different provider (e.g. `glm-5.1` under `zai`), use that for spec reference (contextWindow, maxTokens, cost)
3. `bun patch @mariozechner/pi-ai` → edit `dist/models.generated.js` → `bun patch --commit 'node_modules/@mariozechner/pi-ai'`
4. Verify: `bun install && bun run tsc`

### Provider notes

| Provider | baseUrl | api | auth | notes |
|----------|---------|-----|------|-------|
| `opencode-go` | `https://opencode.ai/zen/go/v1` | `openai-completions` | `OPENCODE_API_KEY` | No compat flags needed |
| `github-copilot` | `https://api.individual.githubcopilot.com` | varies per model family | OAuth token | Needs Copilot `headers`; Gemini models use `openai-completions` with `compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false }` |
| `zai` | `https://api.z.ai/api/coding/paas/v4` | `openai-completions` | `ZAI_API_KEY` | Has `compat: { supportsDeveloperRole: false, thinkingFormat: "zai", zaiToolStream: true }` |

### Model ID gotchas

- `github-copilot` Gemini models use `-preview` suffixes internally (e.g. `gemini-3-flash-preview`), but pi-ai has normalizers that map short names like `gemini-3-flash` → `gemini-3-flash-preview`
- The runtime config (`openclaw.json`) references models by `provider/model-id` — if the model ID doesn't exist in `models.generated.js` for that provider, it will timeout at runtime
- `pi-coding-agent/dist/core/model-resolver.js` has `defaultModelPerProvider` and fallback logic, but actual model lists come from `pi-ai`

### Current patches

| Package | Patch | What |
|---------|-------|------|
| `openclaw@2026.4.14` | `patches/openclaw@2026.4.14.patch` | Mattermost websocket keepalive (explicit reply tags when threading is off landed upstream) |

## NOTES

- The `rtk/` directory (37 wrapper scripts) is the legacy PATH-prepend approach. The `rtk-rewrite` plugin supersedes it but wrappers remain for the companion Docker image
- `openclaw` binary comes from npm (`openclaw@2026.4.14`), not built from source
- Browser container gets static IP (172.20.0.10) because CDP rejects hostname-based Host headers
- Container runs as `node` user (UID 1000) — mounted volumes must match ownership
- **This is a Raspberry Pi** — do not spawn heavy/parallel agents that consume excessive RAM
