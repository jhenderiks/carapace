import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  applyRtkRouting,
  normalizeRtkConfig,
  type RewriteOptions,
} from "./routing.ts";
import type { RtkConfig } from "./types.ts";

type ToolParams = Record<string, unknown>;

function asRecord(value: unknown): ToolParams | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as ToolParams;
}

export function maybeRewriteToolParams(
  toolName: string,
  params: unknown,
  config: RtkConfig,
  options?: RewriteOptions,
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

  const rewritten = applyRtkRouting(command, config, options);

  return rewritten === null
    ? null
    : {
        ...record,
        command: rewritten,
      };
}

export default function register(api: OpenClawPluginApi): void {
  const config = normalizeRtkConfig(api.pluginConfig);

  if (!config.enabled) {
    return;
  }

  let warnedBinaryFailure = false;

  api.on("before_tool_call", (event) => {
    const params = maybeRewriteToolParams(event.toolName, event.params, config, {
      onError: (error) => {
        if (!warnedBinaryFailure) {
          warnedBinaryFailure = true;
          api.logger.warn(
            `[rtk-rewrite] rtk rewrite failed, commands will not be rewritten: ${error instanceof Error ? error.message : error}`,
          );
        }
      },
    });

    return params ? { params } : undefined;
  });
}
