import { execFileSync } from "node:child_process";
import type { RtkConfig } from "./types.js";

export const DEFAULT_RTK_CONFIG: RtkConfig = {
  enabled: true,
  binary: "/usr/local/bin/rtk",
};

function defaultExec(binary: string, args: string[]): string {
  return execFileSync(binary, args, {
    encoding: "utf-8",
    timeout: 5_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

export function normalizeRtkConfig(rawConfig: unknown): RtkConfig {
  const config = (rawConfig as Partial<RtkConfig>) ?? {};

  return {
    enabled: typeof config.enabled === "boolean" ? config.enabled : DEFAULT_RTK_CONFIG.enabled,
    binary: typeof config.binary === "string" && config.binary.length > 0
      ? config.binary
      : DEFAULT_RTK_CONFIG.binary,
  };
}

type ExecFn = (binary: string, args: string[]) => string;

export type RewriteOptions = {
  onError?: (error: unknown) => void;
  exec?: ExecFn;
};

export function applyRtkRouting(
  command: string,
  config: RtkConfig,
  options?: RewriteOptions,
): string | null {
  if (!config.enabled) {
    return null;
  }

  if (typeof command !== "string" || command.length === 0) {
    return null;
  }

  const run = options?.exec ?? defaultExec;
  let rewritten: string;

  try {
    rewritten = run(config.binary, ["rewrite", command]).trim();
  } catch (error: unknown) {
    options?.onError?.(error);
    return null;
  }

  if (rewritten.length === 0 || rewritten === command) {
    return null;
  }

  return rewritten;
}
