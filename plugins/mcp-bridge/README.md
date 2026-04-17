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

> **Note:** RTK command rewriting is provided by RTK's upstream OpenClaw plugin, fetched during the gateway image build. Context-mode ships as a separate repo-local plugin — see `plugins/context-mode/`.

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
