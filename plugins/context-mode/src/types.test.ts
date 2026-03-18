import { strict as assert } from "node:assert";

import { normalizeContextModeConfig } from "./types.js";

{
  const config = normalizeContextModeConfig(undefined);

  assert.deepEqual(config.skipTools, ["ctx_execute", "ctx_batch_execute"]);
}

{
  const config = normalizeContextModeConfig({
    skipTools: ["ctx_execute", "ctx_execute", "ctx_batch_execute", 123],
  });

  assert.deepEqual(config.skipTools, ["ctx_execute", "ctx_batch_execute"]);
}

console.log("context-mode types tests passed");
