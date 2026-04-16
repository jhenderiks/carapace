# mcp-bridge (Phase 1)

OpenClaw plugin that bridges MCP stdio servers into agent tools.

## Current scope

- ✅ Spawn MCP server processes over stdio
- ✅ Discover MCP tools with `listTools`
- ✅ Register each MCP tool as an OpenClaw tool (`{prefix}_{name}`)
- ✅ Proxy tool calls via `callTool`
- ✅ Retry once after reconnect on tool call failure
- ✅ Graceful disconnect on `gateway_stop`
- ⚠️ `lifecycle: "session"` is currently treated as shared/gateway lifecycle

> **Note:** RTK command rewriting was originally planned here but shipped as a standalone plugin (`rtk-rewrite`). Context-mode also shipped as a separate plugin (`context-mode`) — see `plugins/context-mode/`.

## Install (linked local plugin)

```bash
openclaw plugins install -l ./plugins/mcp-bridge
```

## Example config

```json5
{
  plugins: {
    entries: {
      "mcp-bridge": {
        enabled: true,
        config: {
          servers: {
            "my-server": {
              command: "my-mcp-server",
              args: [],
              env: { MY_API_URL: "https://example.com" },
              lifecycle: "gateway",
              toolPrefix: "ms",
              optional: false,
              timeoutMs: 30000,
              retryCount: 1,
              retryBackoffMs: 500
            }
          }
        }
      }
    }
  }
}
```

## Notes

- MCP tools are discovered at plugin startup and registered dynamically.
- Tool name collisions are logged and skipped.
- Config validation is enforced by `openclaw.plugin.json`.
