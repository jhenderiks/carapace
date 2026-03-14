import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  asRecord,
  executeWithRetry,
  formatError,
  McpServerBridge,
  normalizeJsonSchema,
  normalizeMcpResult,
} from "../../mcp-bridge/index.js";
import { normalizeContextModeConfig, toServerConfig } from "./types.js";

type CachedToolDefs = Awaited<ReturnType<McpServerBridge["listTools"]>>;

// Module-level bridge cache: one MCP process per agent workspace.
// Keyed by workspaceDir to handle registry reloads (different cache keys
// still reuse the same bridge/process).
const bridgeCache = new Map<string, McpServerBridge>();

// Cache tool definitions from the first listTools() call — MCP tool
// metadata doesn't change between agents.
let cachedToolDefs: CachedToolDefs | null = null;
let toolDefsPromise: Promise<CachedToolDefs> | null = null;

export default function register(api: OpenClawPluginApi): void {
  const config = normalizeContextModeConfig(api.pluginConfig);
  const skipTools = new Set(config.skipTools);

  // Fetch tool definitions once (any bridge will do — tools are the same).
  async function ensureToolDefs(): Promise<CachedToolDefs> {
    if (cachedToolDefs) {
      return cachedToolDefs;
    }

    if (toolDefsPromise) {
      return toolDefsPromise;
    }

    toolDefsPromise = (async () => {
      const tempConfig = toServerConfig(config);
      const tempBridge = new McpServerBridge(tempConfig.id, tempConfig, api.logger);
      const tools = await tempBridge.listTools();
      cachedToolDefs = tools;

      // Disconnect the bootstrap bridge — it was only needed for listTools().
      // Per-agent bridges are created on demand in getOrCreateBridge().
      try {
        await tempBridge.disconnect();
      } catch {
        // best-effort cleanup
      }

      return tools;
    })();

    try {
      return await toolDefsPromise;
    } finally {
      toolDefsPromise = null;
    }
  }

  function getOrCreateBridge(workspaceDir: string): McpServerBridge {
    const existingBridge = bridgeCache.get(workspaceDir);
    if (existingBridge) {
      return existingBridge;
    }

    const baseServerConfig = toServerConfig(config);
    const serverConfig = {
      ...baseServerConfig,
      env: {
        ...baseServerConfig.env,
        CLAUDE_PROJECT_DIR: workspaceDir,
      },
    };

    const bridge = new McpServerBridge(
      `${serverConfig.id}-${workspaceDir}`,
      serverConfig,
      api.logger,
    );

    bridgeCache.set(workspaceDir, bridge);
    return bridge;
  }

  // Register a tool factory. OpenClaw calls this for each agent session,
  // passing the agent's context (agentId, workspaceDir, etc.).
  // The factory returns tools bound to that agent's bridge.
  api.registerTool((ctx) => {
    const workspaceDir = ctx.workspaceDir ?? "/workspace";
    const bridge = getOrCreateBridge(workspaceDir);
    const prefix = config.toolPrefix;

    // Tool definitions must be returned synchronously from the factory.
    // We can't await ensureToolDefs() here. Two approaches:
    //
    // A) Pre-populate cachedToolDefs in gateway_start (before any session).
    // B) Return a fixed set of known tool names.
    //
    // We use approach A: gateway_start populates the cache, factory reads it.
    if (!cachedToolDefs) {
      api.logger.warn("[context-mode] tool definitions not yet loaded — skipping");
      return null;
    }

    const tools: AnyAgentTool[] = [];

    for (const mcpTool of cachedToolDefs) {
      if (skipTools.has(mcpTool.name)) {
        continue;
      }

      const toolName = prefix ? `${prefix}_${mcpTool.name}` : mcpTool.name;

      tools.push({
        name: toolName,
        label: toolName,
        description: mcpTool.description ?? `context-mode: ${mcpTool.name}`,
        parameters: normalizeJsonSchema(mcpTool.inputSchema),
        async execute(_toolCallId, params) {
          const result = await executeWithRetry(
            { config: toServerConfig(config), bridge },
            mcpTool.name,
            asRecord(params),
            api.logger,
          );

          return normalizeMcpResult(result, toolName, "context-mode", "context-mode");
        },
      });
    }

    api.logger.info(
      `[context-mode] ${ctx.agentId ?? "unknown"}: ${tools.length} tools (workspace: ${workspaceDir})`,
    );

    return tools;
  });

  // Pre-load tool definitions so the factory has them synchronously.
  api.on("gateway_start", async () => {
    try {
      await ensureToolDefs();
      api.logger.info(
        `[context-mode] ready (${cachedToolDefs!.length} tool defs cached)`,
      );
    } catch (error) {
      api.logger.error(
        `[context-mode] failed to load tool definitions: ${formatError(error)}`,
      );
    }
  });

  api.on("gateway_stop", async () => {
    for (const [key, bridge] of bridgeCache) {
      try {
        await bridge.disconnect();
      } catch (error) {
        api.logger.warn(
          `[context-mode] shutdown error (${key}): ${formatError(error)}`,
        );
      }
    }

    bridgeCache.clear();
    cachedToolDefs = null;
    toolDefsPromise = null;
  });
}
