import { execFileSync } from "node:child_process";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export type RtkPluginConfig = {
  enabled: boolean;
  verbose: boolean;
};

export type ToolParams = Record<string, unknown>;

type ExecFn = (file: string, args: string[]) => string;

export function normalizeRtkPluginConfig(
  pluginConfig: Record<string, unknown> | undefined,
): RtkPluginConfig {
  return {
    enabled: pluginConfig?.enabled !== false,
    verbose: pluginConfig?.verbose === true,
  };
}

function asRecord(value: unknown): ToolParams | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as ToolParams;
}

function defaultExec(file: string, args: string[]): string {
  return execFileSync(file, args, {
    encoding: "utf-8",
    timeout: 2_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

export function checkRtk(exec: ExecFn = defaultExec): boolean {
  try {
    exec("rtk", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export function tryRewrite(
  command: string,
  exec: ExecFn = defaultExec,
): string | null {
  try {
    const result = exec("rtk", ["rewrite", command]).trim();
    return result.length > 0 && result !== command ? result : null;
  } catch {
    return null;
  }
}

export function maybeRewriteToolParams(
  toolName: string,
  params: unknown,
  exec: ExecFn = defaultExec,
): ToolParams | null {
  if (toolName !== "exec") {
    return null;
  }

  const record = asRecord(params);
  if (!record) {
    return null;
  }

  const command = record.command;
  if (typeof command !== "string") {
    return null;
  }

  const rewritten = tryRewrite(command, exec);
  return rewritten === null
    ? null
    : {
        ...record,
        command: rewritten,
      };
}

export default function register(api: OpenClawPluginApi): void {
  const config = normalizeRtkPluginConfig(api.pluginConfig);

  if (!config.enabled) {
    return;
  }

  if (!checkRtk()) {
    api.logger.warn("[rtk-rewrite] rtk binary not found in PATH; plugin disabled");
    return;
  }

  api.on(
    "before_tool_call",
    (event) => {
      const params = maybeRewriteToolParams(event.toolName, event.params);
      if (!params) {
        return undefined;
      }

      if (config.verbose) {
        api.logger.info(
          `[rtk-rewrite] ${String((event.params as ToolParams)?.command)} -> ${String(params.command)}`,
        );
      }

      return { params };
    },
    { priority: 10 },
  );

  if (config.verbose) {
    api.logger.info("[rtk-rewrite] OpenClaw plugin registered");
  }
}
