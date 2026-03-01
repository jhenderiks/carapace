import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { applyRtkRouting, normalizeRtkConfig } from "./routing.js";

export default function register(api: OpenClawPluginApi): void {
  const config = normalizeRtkConfig(api.pluginConfig);

  if (!config.enabled) {
    return;
  }

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

    return {
      params: {
        ...event.params,
        command: rewritten,
      },
    };
  });
}
