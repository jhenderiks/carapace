import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type {
  AnyAgentTool,
  OpenClawPluginApi,
  RuntimeLogger,
} from "openclaw/plugin-sdk";
import {
  asRecord,
  executeWithRetry,
  formatError,
  McpServerBridge,
  normalizeJsonSchema,
  normalizeMcpResult,
  type NormalizedServerConfig,
} from "../../mcp-bridge/index.js";
import { normalizeContextModeConfig, toServerConfig } from "./types.js";

type CachedToolDefs = Awaited<ReturnType<McpServerBridge["listTools"]>>;

type SandboxRegistryEntry = {
  containerName: string;
  sessionKey: string;
};

const SANDBOX_CM_SERVER_PATH =
  "/opt/openclaw/node_modules/context-mode/server.bundle.mjs";

// Module-level bridge cache: one MCP process per agent workspace.
// Keyed by workspaceDir to handle registry reloads (different cache keys
// still reuse the same bridge/process).
const bridgeCache = new Map<string, McpServerBridge>();

// Cache tool definitions from the first listTools() call — MCP tool
// metadata doesn't change between agents.
let cachedToolDefs: CachedToolDefs | null = null;
let toolDefsPromise: Promise<CachedToolDefs | null> | null = null;

function readSandboxRegistry(
  registryPath: string,
  logger: RuntimeLogger,
): SandboxRegistryEntry[] {
  try {
    const raw = JSON.parse(readFileSync(registryPath, "utf-8")) as {
      entries?: unknown;
    };
    const entries = Array.isArray(raw?.entries) ? raw.entries : [];

    return entries.filter(
      (entry): entry is SandboxRegistryEntry =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as SandboxRegistryEntry).sessionKey === "string" &&
        typeof (entry as SandboxRegistryEntry).containerName === "string",
    );
  } catch (error) {
    logger.warn(
      `[context-mode] failed to read sandbox registry: ${formatError(error)}`,
    );
    return [];
  }
}

function isSandboxContainerRunning(
  containerName: string,
  logger: RuntimeLogger,
): boolean {
  try {
    const output = execSync(
      `docker inspect --format='{{.State.Running}}' ${containerName}`,
      {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf-8",
      },
    );

    return output.trim() === "true";
  } catch (error) {
    logger.warn(
      `[context-mode] failed to inspect sandbox container "${containerName}": ${formatError(error)}`,
    );
    return false;
  }
}

function resolveSandboxContainerName(
  registryPath: string,
  agentId: string,
  logger: RuntimeLogger,
): string | null {
  const sessionKey = `agent:${agentId}`;
  const entry = readSandboxRegistry(registryPath, logger).find(
    (item) => item.sessionKey === sessionKey,
  );

  if (!entry) {
    return null;
  }

  if (!isSandboxContainerRunning(entry.containerName, logger)) {
    logger.warn(
      `[context-mode] sandbox container "${entry.containerName}" for agent "${agentId}" is not running`,
    );
    return null;
  }

  return entry.containerName;
}

function resolveAnySandboxContainerName(
  registryPath: string,
  logger: RuntimeLogger,
): string | null {
  const entries = readSandboxRegistry(registryPath, logger);

  for (const entry of entries) {
    if (isSandboxContainerRunning(entry.containerName, logger)) {
      return entry.containerName;
    }
  }

  return null;
}

export default function register(api: OpenClawPluginApi): void {
  const config = normalizeContextModeConfig(api.pluginConfig);
  const skipTools = new Set(config.skipTools);

  function buildSandboxServerConfig(
    baseServerConfig: NormalizedServerConfig,
    containerName: string,
    workspaceDir: string,
  ): NormalizedServerConfig {
    return {
      ...baseServerConfig,
      command: "docker",
      args: [
        "exec",
        "-i",
        "-e",
        `CLAUDE_PROJECT_DIR=${workspaceDir}`,
        containerName,
        "node",
        SANDBOX_CM_SERVER_PATH,
      ],
      env: {},
    };
  }

  // Fetch tool definitions once (any bridge will do — tools are the same).
  async function ensureToolDefs(): Promise<CachedToolDefs | null> {
    if (cachedToolDefs) {
      return cachedToolDefs;
    }

    if (toolDefsPromise) {
      return toolDefsPromise;
    }

    toolDefsPromise = (async () => {
      const baseServerConfig = toServerConfig(config);
      let tempConfig = baseServerConfig;

      if (config.sandboxExec) {
        const containerName = resolveAnySandboxContainerName(
          config.sandboxRegistryPath,
          api.logger,
        );

        if (!containerName) {
          return null;
        }

        tempConfig = buildSandboxServerConfig(
          baseServerConfig,
          containerName,
          "/workspace",
        );
      }

      const tempBridge = new McpServerBridge(tempConfig.id, tempConfig, api.logger);

      try {
        const tools = await tempBridge.listTools();
        cachedToolDefs = tools;
        return tools;
      } finally {
        // Disconnect the bootstrap bridge — it was only needed for listTools().
        // Per-agent bridges are created on demand in getOrCreateBridge().
        try {
          await tempBridge.disconnect();
        } catch {
          // best-effort cleanup
        }
      }
    })();

    try {
      return await toolDefsPromise;
    } finally {
      toolDefsPromise = null;
    }
  }

  function getOrCreateBridge(
    workspaceDir: string,
    agentId: string | undefined,
  ): McpServerBridge {
    const existingBridge = bridgeCache.get(workspaceDir);
    if (existingBridge) {
      return existingBridge;
    }

    const baseServerConfig = toServerConfig(config);
    let serverConfig: NormalizedServerConfig;

    if (config.sandboxExec) {
      if (!agentId) {
        throw new Error(
          "[context-mode] sandboxExec is enabled but no agentId available",
        );
      }

      const containerName = resolveSandboxContainerName(
        config.sandboxRegistryPath,
        agentId,
        api.logger,
      );

      if (!containerName) {
        throw new Error(
          `[context-mode] sandboxExec is enabled but no sandbox container found for agent \"${agentId}\"`,
        );
      }

      serverConfig = buildSandboxServerConfig(
        baseServerConfig,
        containerName,
        workspaceDir,
      );

      api.logger.info(`[context-mode] sandbox exec: ${agentId} → ${containerName}`);
    } else {
      serverConfig = {
        ...baseServerConfig,
        env: {
          ...baseServerConfig.env,
          CLAUDE_PROJECT_DIR: workspaceDir,
        },
      };
    }

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
  api.registerTool(async (ctx) => {
    const workspaceDir = ctx.workspaceDir ?? "/workspace";

    if (!cachedToolDefs) {
      await ensureToolDefs();
    }

    if (!cachedToolDefs) {
      api.logger.warn("[context-mode] tool definitions unavailable — skipping");
      return null;
    }

    // Ensure bridge can be created for this session (and warm cache).
    getOrCreateBridge(workspaceDir, ctx.agentId);

    const prefix = config.toolPrefix;

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
          const bridge =
            bridgeCache.get(workspaceDir) ??
            getOrCreateBridge(workspaceDir, ctx.agentId);

          try {
            const result = await executeWithRetry(
              { config: toServerConfig(config), bridge },
              mcpTool.name,
              asRecord(params),
              api.logger,
            );

            return normalizeMcpResult(result, toolName, "context-mode", "context-mode");
          } catch (error) {
            bridgeCache.delete(workspaceDir);
            try {
              await bridge.disconnect();
            } catch {
              // best-effort cleanup
            }
            throw error;
          }
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
      const toolDefs = await ensureToolDefs();

      if (!toolDefs) {
        api.logger.info(
          "[context-mode] sandbox exec enabled but no sandbox container available for bootstrap",
        );
        return;
      }

      api.logger.info(`[context-mode] ready (${toolDefs.length} tool defs cached)`);
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
