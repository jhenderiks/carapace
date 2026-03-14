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

export default function register(api: OpenClawPluginApi): void {
  const config = normalizeContextModeConfig(api.pluginConfig);
  const serverConfig = toServerConfig(config);
  const bridge = new McpServerBridge(serverConfig.id, serverConfig, api.logger);
  const skipTools = new Set(config.skipTools);
  const registeredToolNames = new Set<string>();
  let initialized = false;

  api.on("gateway_start", async () => {
    if (initialized) {
      return;
    }

    try {
      // bridge.listTools() implicitly connects on first call — no explicit
      // connect() needed. Same pattern as mcp-bridge handler.
      const tools = await bridge.listTools();
      let registeredCount = 0;

      for (const mcpTool of tools) {
        if (skipTools.has(mcpTool.name)) {
          continue;
        }

        const toolName = serverConfig.toolPrefix
          ? `${serverConfig.toolPrefix}_${mcpTool.name}`
          : mcpTool.name;

        if (registeredToolNames.has(toolName)) {
          api.logger.warn(`[context-mode] duplicate tool name skipped: ${toolName}`);
          continue;
        }

        const tool: AnyAgentTool = {
          name: toolName,
          label: toolName,
          description: mcpTool.description ?? `context-mode: ${mcpTool.name}`,
          parameters: normalizeJsonSchema(mcpTool.inputSchema),
          async execute(_toolCallId, params) {
            const result = await executeWithRetry(
              { config: serverConfig, bridge },
              mcpTool.name,
              asRecord(params),
              api.logger,
            );
            return normalizeMcpResult(
              result,
              toolName,
              serverConfig.id,
              "context-mode",
            );
          },
        };

        api.registerTool(tool);
        registeredToolNames.add(toolName);
        registeredCount += 1;
      }

      initialized = true;
      api.logger.info(
        `[context-mode] ready (${registeredCount}/${tools.length} tools registered)`,
      );
    } catch (error) {
      api.logger.error(`[context-mode] initialization failed: ${formatError(error)}`);
    }
  });

  api.on("gateway_stop", async () => {
    try {
      await bridge.disconnect();
    } catch (error) {
      api.logger.warn(`[context-mode] shutdown error: ${formatError(error)}`);
    }
  });
}
