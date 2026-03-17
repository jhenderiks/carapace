import {
  coercePositiveInt,
  isPlainObject,
  type NormalizedServerConfig,
} from "../../mcp-bridge/index.js";

const DEFAULT_COMMAND = "context-mode";
const DEFAULT_TOOL_PREFIX = "cm";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SKIP_TOOLS: string[] = [];
const DEFAULT_SANDBOX_REGISTRY_PATH =
  "/home/openclaw/.openclaw/sandbox/containers.json";

export type RawContextModeConfig = {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  toolPrefix?: unknown;
  skipTools?: unknown;
  timeoutMs?: unknown;
  sandboxExec?: unknown;
  sandboxRegistryPath?: unknown;
};

export type NormalizedContextModeConfig = {
  command: string;
  args: string[];
  env: Record<string, string>;
  toolPrefix: string;
  skipTools: string[];
  timeoutMs: number;
  sandboxExec: boolean;
  sandboxRegistryPath: string;
};

export function normalizeContextModeConfig(
  pluginConfig: Record<string, unknown> | undefined,
): NormalizedContextModeConfig {
  const raw = (isPlainObject(pluginConfig) ? pluginConfig : {}) as RawContextModeConfig;
  const envSource = isPlainObject(raw.env) ? raw.env : {};

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envSource)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  return {
    command:
      typeof raw.command === "string" && raw.command.trim()
        ? raw.command.trim()
        : DEFAULT_COMMAND,
    args: Array.isArray(raw.args)
      ? raw.args.filter((arg): arg is string => typeof arg === "string")
      : [],
    env,
    toolPrefix:
      typeof raw.toolPrefix === "string" && raw.toolPrefix.trim()
        ? raw.toolPrefix.trim()
        : DEFAULT_TOOL_PREFIX,
    skipTools: Array.isArray(raw.skipTools)
      ? [...new Set(raw.skipTools.filter((name): name is string => typeof name === "string"))]
      : [...DEFAULT_SKIP_TOOLS],
    timeoutMs: coercePositiveInt(raw.timeoutMs, DEFAULT_TIMEOUT_MS),
    sandboxExec: raw.sandboxExec === true,
    sandboxRegistryPath:
      typeof raw.sandboxRegistryPath === "string" && raw.sandboxRegistryPath.trim()
        ? raw.sandboxRegistryPath.trim()
        : DEFAULT_SANDBOX_REGISTRY_PATH,
  };
}

export function toServerConfig(
  config: NormalizedContextModeConfig,
): NormalizedServerConfig {
  return {
    id: "context-mode",
    command: config.command,
    args: config.args,
    env: config.env,
    lifecycle: "gateway",
    toolPrefix: config.toolPrefix,
    optional: false,
    disabled: false,
    timeoutMs: config.timeoutMs,
    retryCount: 1,
    retryBackoffMs: 500,
  };
}
