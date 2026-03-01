import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { applyRtkRouting, normalizeRtkConfig } from "./routing.js";

export default function register(api: OpenClawPluginApi): void {
  api.logger.info("[rtk-rewrite] plugin register() called");
  const config = normalizeRtkConfig(api.pluginConfig);
  api.logger.info(`[rtk-rewrite] config.enabled=${config.enabled}, binary=${config.binary}`);

  if (!config.enabled) {
    api.logger.info("[rtk-rewrite] disabled by config, skipping hook registration");
    return;
  }

  api.logger.info("[rtk-rewrite] registering before_tool_call hook");

  api.on("before_tool_call", (event) => {
    if (event.toolName !== "exec") {
      return;
    }

    const command = event.params?.command;

    if (typeof command !== "string") {
      return;
    }

    const rewritten = applyRtkRouting(command, config);
    if (rewritten === null) {
      return;
    }

    api.logger.info(`[rtk-rewrite] rewriting: ${command.slice(0, 80)} → ${rewritten.slice(0, 80)}`);

    return {
      params: {
        ...event.params,
        command: rewritten,
      },
    };
  });
}
