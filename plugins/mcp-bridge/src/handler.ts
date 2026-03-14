import type {
  AnyAgentTool,
  OpenClawPluginApi,
  RuntimeLogger,
} from "openclaw/plugin-sdk";
import { McpServerBridge } from "./bridge.js";
import {
  asRecord,
  coerceNonNegativeInt,
  coercePositiveInt,
  executeWithRetry,
  formatError,
  isPlainObject,
  normalizeMcpResult,
} from "./runtime.js";
import { normalizeJsonSchema } from "./schema.js";
import type {
  McpToolDefinition,
  NormalizedPluginConfig,
  NormalizedServerConfig,
  RawPluginConfig,
  RawServerConfig,
  ServerLifecycle,
} from "./types.js";

type ServerRuntime = {
  config: NormalizedServerConfig;
  bridge: McpServerBridge;
  initialized: boolean;
};

export default function register(api: OpenClawPluginApi): void {
  const config = normalizePluginConfig(api.pluginConfig, api.logger);
  const serverEntries = Object.entries(config.servers);

  if (serverEntries.length === 0) {
    api.logger.warn(
      "[mcp-bridge] no servers configured; plugin loaded but idle",
    );
    return;
  }

  const runtimes = new Map<string, ServerRuntime>();
  const registeredToolNames = new Set<string>();

  for (const [serverId, serverConfig] of serverEntries) {
    if (serverConfig.disabled) {
      api.logger.info(`[mcp-bridge] server disabled by config: ${serverId}`);
      continue;
    }

    if (serverConfig.lifecycle === "session") {
      api.logger.warn(
        `[mcp-bridge] server ${serverId} requests lifecycle=session; current implementation runs it as shared (gateway)`,
      );
    }

    const runtime: ServerRuntime = {
      config: serverConfig,
      bridge: new McpServerBridge(serverId, serverConfig, api.logger),
      initialized: false,
    };

    runtimes.set(serverId, runtime);
  }

  const initializeServers = async (
    targetLifecycle: ServerLifecycle,
  ): Promise<void> => {
    for (const [serverId, runtime] of runtimes) {
      if (runtime.initialized) {
        continue;
      }

      if (
        runtime.config.lifecycle !== targetLifecycle &&
        runtime.config.lifecycle !== "session"
      ) {
        continue;
      }

      try {
        await initializeServer(api, serverId, runtime, registeredToolNames);
        runtime.initialized = true;
      } catch (error) {
        api.logger.error(
          `[mcp-bridge] failed to initialize server ${serverId}: ${formatError(error)}`,
        );
      }
    }
  };

  api.on("gateway_start", async () => {
    await initializeServers("gateway");
  });

  api.on("gateway_stop", async () => {
    for (const [serverId, runtime] of runtimes) {
      try {
        await runtime.bridge.disconnect();
      } catch (error) {
        api.logger.warn(
          `[mcp-bridge] shutdown error for ${serverId}: ${formatError(error)}`,
        );
      }
    }
  });
}

async function initializeServer(
  api: OpenClawPluginApi,
  serverId: string,
  runtime: ServerRuntime,
  registeredToolNames: Set<string>,
): Promise<void> {
  await runtime.bridge.connect();
  const tools = await runtime.bridge.listTools();

  if (tools.length === 0) {
    api.logger.warn(`[mcp-bridge] server ${serverId} returned no MCP tools`);
    return;
  }

  for (const mcpTool of tools) {
    registerMcpTool(api, runtime, mcpTool, registeredToolNames);
  }

  api.logger.info(
    `[mcp-bridge] server ${serverId} ready (${tools.length} tools)`,
  );
}

function registerMcpTool(
  api: OpenClawPluginApi,
  runtime: ServerRuntime,
  mcpTool: McpToolDefinition,
  registeredToolNames: Set<string>,
): void {
  const openclawToolName = runtime.config.toolPrefix
    ? `${runtime.config.toolPrefix}_${mcpTool.name}`
    : mcpTool.name;

  if (registeredToolNames.has(openclawToolName)) {
    api.logger.warn(
      `[mcp-bridge] duplicate tool name skipped: ${openclawToolName} (server: ${runtime.config.id})`,
    );
    return;
  }

  const tool: AnyAgentTool = {
    name: openclawToolName,
    label: openclawToolName,
    description:
      mcpTool.description ??
      `MCP tool ${mcpTool.name} from server ${runtime.config.id}`,
    parameters: normalizeJsonSchema(mcpTool.inputSchema),
    async execute(_toolCallId, params) {
      const result = await executeWithRetry(
        runtime,
        mcpTool.name,
        asRecord(params),
        api.logger,
      );
      return normalizeMcpResult(result, openclawToolName, runtime.config.id);
    },
  };

  api.registerTool(tool, { optional: runtime.config.optional });
  registeredToolNames.add(openclawToolName);
}

function normalizePluginConfig(
  pluginConfig: Record<string, unknown> | undefined,
  logger: RuntimeLogger,
): NormalizedPluginConfig {
  const raw = (
    isPlainObject(pluginConfig) ? pluginConfig : {}
  ) as RawPluginConfig;
  const rawServers = isPlainObject(raw.servers)
    ? (raw.servers as Record<string, unknown>)
    : {};

  const servers: Record<string, NormalizedServerConfig> = {};

  for (const [serverId, maybeServer] of Object.entries(rawServers)) {
    const normalized = normalizeServerConfig(
      serverId,
      maybeServer as RawServerConfig,
      logger,
    );
    if (normalized) {
      servers[serverId] = normalized;
    }
  }

  return { servers };
}

function normalizeServerConfig(
  serverId: string,
  input: RawServerConfig,
  logger: RuntimeLogger,
): NormalizedServerConfig | undefined {
  if (!isPlainObject(input)) {
    logger.warn(`[mcp-bridge] invalid server config (not object): ${serverId}`);
    return undefined;
  }

  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (!command) {
    logger.warn(
      `[mcp-bridge] missing required command for server: ${serverId}`,
    );
    return undefined;
  }

  const args = Array.isArray(input.args)
    ? input.args.filter((arg): arg is string => typeof arg === "string")
    : [];

  const envSource = isPlainObject(input.env) ? input.env : {};
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(envSource)) {
    if (typeof v === "string") {
      env[k] = v;
    }
  }

  const lifecycle: ServerLifecycle =
    input.lifecycle === "session" ? "session" : "gateway";

  const toolPrefixRaw =
    typeof input.toolPrefix === "string" ? input.toolPrefix.trim() : "";
  const toolPrefix = toolPrefixRaw || serverId.replace(/[^a-zA-Z0-9_]/g, "_");

  const timeoutMs = coercePositiveInt(input.timeoutMs, 30_000);
  const retryCount = coerceNonNegativeInt(input.retryCount, 1);
  const retryBackoffMs = coercePositiveInt(input.retryBackoffMs, 500);

  return {
    id: serverId,
    command,
    args,
    env,
    lifecycle,
    toolPrefix,
    optional: Boolean(input.optional),
    disabled: Boolean(input.disabled),
    timeoutMs,
    retryCount,
    retryBackoffMs,
  };
}
