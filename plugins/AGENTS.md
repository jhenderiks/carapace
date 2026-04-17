# PLUGINS KNOWLEDGE BASE

## OVERVIEW

Two repo-local OpenClaw plugins extend the gateway: MCP server bridging and context-mode FTS5 search. RTK command rewriting comes from RTK's upstream OpenClaw plugin, which the RTK companion image fetches and the gateway image copies into `/opt/openclaw/plugins/rtk-rewrite`.

## PLUGIN ARCHITECTURE

Every plugin follows this structure:
```
{plugin}/
├── index.ts                # Re-exports default handler + public API
├── openclaw.plugin.json    # Plugin metadata + config schema (OpenClaw reads this)
├── package.json            # Deps + custom "openclaw" field
└── src/
    ├── handler.ts          # Default export: plugin lifecycle hooks
    ├── types.ts            # Config types + normalization
    └── *.test.ts           # Co-located tests (node:assert, run via `bun test`)
```

**Lifecycle hooks** available to repo-local plugins:
- `gateway_start` — register tools, spawn processes
- `gateway_stop` — cleanup, disconnect

**Config flow**: `openclaw.plugin.json` defines the JSON schema → OpenClaw validates at load → handler receives typed config.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new MCP server | Config only — no code change | Add entry to `plugins.entries.mcp-bridge.config.servers` |
| Change context-mode tool prefix | Config: `plugins.entries.context-mode.config.toolPrefix` | Default: `cm` |
| Skip context-mode tools | Config: `plugins.entries.context-mode.config.skipTools` | Array of tool names |
| Understand MCP bridging internals | `mcp-bridge/src/bridge.ts` + `runtime.ts` | Process spawn, tool discovery, call proxy |
| Plugin config types | `{plugin}/src/types.ts` | Raw → Normalized config transforms |

## mcp-bridge

Bridges MCP stdio servers into OpenClaw tools. Spawns child processes, discovers tools via `listTools`, registers as `{prefix}_{toolName}`. Retries once after reconnect on failure.

Key files: `bridge.ts` (McpServerBridge class), `runtime.ts` (retry logic, normalization utils), `schema.ts` (JSON schema normalization for MCP tool inputs), `handler.ts` (lifecycle hooks).

Exports public API beyond just the handler — other plugins can import `McpServerBridge`, `executeWithRetry`, etc.

## context-mode

Spawns the context-mode MCP server as a child process and registers `cm_*` tools. Reuses `mcp-bridge` internals (`McpServerBridge`) for process management and tool registration.

Key files: `handler.ts` (lifecycle), `types.ts` (config normalization + tests).

## CONVENTIONS

- Handlers are always the default export
- Types files export both `Raw*Config` and `Normalized*Config` with a `normalize()` function
- Test files use `node:assert` and run under `bun test` — no external test framework
- Imports use `.js` extension (NodeNext resolution requires it even for .ts files)
- mcp-bridge has its own `node_modules/` (depends on `@modelcontextprotocol/sdk`); others rely on root deps
