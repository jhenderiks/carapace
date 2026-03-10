import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { applyRtkRouting, normalizeRtkConfig } from "./routing.js";

export default function register(api: OpenClawPluginApi): void {
  const config = normalizeRtkConfig(api.pluginConfig);

  if (!config.enabled) {
    return;
  }

  let warnedBinaryFailure = false;

  api.on("before_tool_call", (event) => {
    if (event.toolName !== "exec") {
      return;
    }

    const command = event.params?.command;

    if (typeof command !== "string") {
      return;
    }

    const rewritten = applyRtkRouting(command, config, {
      onError: (error) => {
        if (!warnedBinaryFailure) {
          warnedBinaryFailure = true;
          api.logger.warn(
            `[rtk-rewrite] rtk rewrite failed, commands will not be rewritten: ${error instanceof Error ? error.message : error}`,
          );
        }
      },
    });

    if (rewritten === null) {
      return;
    }

    return {
      params: {
        ...event.params,
        command: rewritten,
      },
    };
  });
}
