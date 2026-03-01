import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { RuntimeLogger } from "openclaw/plugin-sdk";
import type { McpCallResult, McpToolDefinition, NormalizedServerConfig } from "./types.js";

const PLUGIN_VERSION = "0.1.0";

export class McpServerBridge {
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;
  private connectPromise: Promise<void> | undefined;

  constructor(
    private readonly serverId: string,
    private readonly config: NormalizedServerConfig,
    private readonly logger: RuntimeLogger,
  ) {}

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      const transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: {
          ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === "string") as Array<[string, string]>),
          ...this.config.env,
        },
      });

      const client = new Client({
        name: `openclaw-mcp-bridge/${this.serverId}`,
        version: PLUGIN_VERSION,
      });

      await this.withTimeout(client.connect(transport), this.config.timeoutMs, "connect");

      this.client = client;
      this.transport = transport;
      this.logger.info(`[mcp-bridge] connected: ${this.serverId}`);
    })();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  async listTools(): Promise<McpToolDefinition[]> {
    await this.connect();
    const result = await this.withTimeout(
      this.client!.listTools(),
      this.config.timeoutMs,
      "listTools",
    );
    const tools = Array.isArray(result?.tools) ? result.tools : [];

    const output: McpToolDefinition[] = [];

    for (const tool of tools) {
      const name = typeof tool?.name === "string" ? tool.name.trim() : "";
      if (!name) {
        continue;
      }

      const inputSchema = isPlainObject(tool?.inputSchema)
        ? (tool.inputSchema as Record<string, unknown>)
        : undefined;

      const toolDef: McpToolDefinition = {
        name,
        inputSchema,
      };

      if (typeof tool?.description === "string") {
        toolDef.description = tool.description;
      }

      output.push(toolDef);
    }

    return output;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    await this.connect();

    try {
      const result = await this.withTimeout(
        this.client!.callTool({
          name,
          arguments: args,
        }),
        this.config.timeoutMs,
        `callTool:${name}`,
      );
      return (result ?? {}) as McpCallResult;
    } catch (error) {
      this.markDisconnected();
      throw error;
    }
  }

  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  async disconnect(): Promise<void> {
    const client = this.client as { close?: () => Promise<void> | void } | undefined;
    const transport = this.transport as { close?: () => Promise<void> | void } | undefined;

    this.markDisconnected();

    try {
      await client?.close?.();
    } catch (error) {
      this.logger.warn(
        `[mcp-bridge] client close failed (${this.serverId}): ${formatError(error)}`,
      );
    }

    try {
      await transport?.close?.();
    } catch (error) {
      this.logger.warn(
        `[mcp-bridge] transport close failed (${this.serverId}): ${formatError(error)}`,
      );
    }
  }

  private markDisconnected(): void {
    this.client = undefined;
    this.transport = undefined;
    this.connectPromise = undefined;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, op: string): Promise<T> {
    const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000;

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race<T>([
        promise,
        new Promise<T>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(
              new Error(`[mcp-bridge] ${this.serverId} ${op} timed out after ${ms}ms`),
            );
          }, ms);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
