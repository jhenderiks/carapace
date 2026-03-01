export type ServerLifecycle = "gateway" | "session";

export type RawServerConfig = {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  lifecycle?: unknown;
  toolPrefix?: unknown;
  optional?: unknown;
  disabled?: unknown;
  timeoutMs?: unknown;
  retryCount?: unknown;
  retryBackoffMs?: unknown;
};

export type RawPluginConfig = {
  servers?: unknown;
  rtk?: unknown;
};

export type NormalizedServerConfig = {
  id: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  lifecycle: ServerLifecycle;
  toolPrefix?: string;
  optional: boolean;
  disabled: boolean;
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
};

export type NormalizedPluginConfig = {
  servers: Record<string, NormalizedServerConfig>;
};

export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpCallResult = {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
};
