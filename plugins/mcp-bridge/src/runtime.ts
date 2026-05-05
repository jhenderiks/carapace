import type { RuntimeLogger } from "openclaw/plugin-sdk";
import type { McpServerBridge } from "./bridge.ts";
import type { McpCallResult, NormalizedServerConfig } from "./types.ts";

export type McpToolRuntime = {
  config: Pick<
    NormalizedServerConfig,
    "id" | "retryCount" | "retryBackoffMs"
  >;
  bridge: Pick<McpServerBridge, "callTool" | "reconnect">;
};

export async function executeWithRetry(
  runtime: McpToolRuntime,
  mcpToolName: string,
  args: Record<string, unknown>,
  logger: RuntimeLogger,
): Promise<McpCallResult> {
  const attempts = Math.max(1, runtime.config.retryCount + 1);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runtime.bridge.callTool(mcpToolName, args);
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }

      const backoffMs = runtime.config.retryBackoffMs * attempt;
      logger.warn(
        `[mcp-bridge] ${runtime.config.id}.${mcpToolName} failed (attempt ${attempt}/${attempts}); reconnecting in ${backoffMs}ms: ${formatError(error)}`,
      );

      await sleep(backoffMs);
      await runtime.bridge.reconnect();
    }
  }

  throw new Error("unreachable");
}

export function normalizeMcpResult(
  result: McpCallResult,
  toolName: string,
  serverId: string,
  source = "mcp-bridge",
): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  const content = normalizeContent(result?.content);
  const details: Record<string, unknown> = {};

  if (result?.structuredContent !== undefined) {
    details.structuredContent = result.structuredContent;
  }

  if (result?.isError) {
    const prefixed = content.length
      ? content
      : [
          {
            type: "text" as const,
            text: "MCP server returned an error with empty content.",
          },
        ];

    return {
      content: [
        {
          type: "text",
          text: `[${source}:${serverId}:${toolName}] upstream error`,
        },
        ...prefixed,
      ],
      details,
    };
  }

  if (content.length > 0) {
    return {
      content,
      details,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: "MCP tool returned no textual content.",
      },
    ],
    details,
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function coercePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

export function coerceNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : fallback;
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeContent(
  content: unknown,
): Array<{ type: "text"; text: string }> {
  if (!Array.isArray(content)) {
    return [];
  }

  const out: Array<{ type: "text"; text: string }> = [];

  for (const item of content) {
    if (
      isPlainObject(item) &&
      item.type === "text" &&
      typeof item.text === "string"
    ) {
      out.push({ type: "text", text: item.text });
      continue;
    }

    if (isPlainObject(item) && typeof item.text === "string") {
      out.push({ type: "text", text: item.text });
      continue;
    }

    out.push({ type: "text", text: safeJson(item) });
  }

  return out;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
