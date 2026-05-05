import register from "./src/handler.ts";

export default register;
export { McpServerBridge } from "./src/bridge.ts";
export {
  asRecord,
  coerceNonNegativeInt,
  coercePositiveInt,
  executeWithRetry,
  formatError,
  isPlainObject,
  normalizeMcpResult,
  sleep,
  type McpToolRuntime,
} from "./src/runtime.ts";
export { deepNormalizeSchema, normalizeJsonSchema } from "./src/schema.ts";
export type {
  McpCallResult,
  McpToolDefinition,
  NormalizedPluginConfig,
  NormalizedServerConfig,
  RawPluginConfig,
  RawServerConfig,
  ServerLifecycle,
} from "./src/types.ts";
