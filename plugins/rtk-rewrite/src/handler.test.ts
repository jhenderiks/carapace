import { strict as assert } from "node:assert";

import { DEFAULT_RTK_CONFIG } from "./routing.js";
import { maybeRewriteToolParams } from "./handler.js";

{
  const params = maybeRewriteToolParams(
    "exec",
    { command: "git status", workdir: "/tmp" },
    DEFAULT_RTK_CONFIG,
    { exec: () => "rtk git status" },
  );

  assert.deepEqual(params, {
    command: "rtk git status",
    workdir: "/tmp",
  });
}

{
  const params = maybeRewriteToolParams(
    "exec",
    { command: "git status" },
    DEFAULT_RTK_CONFIG,
    {
      exec: () => "git status",
    },
  );

  assert.equal(params, null);
}

{
  const params = maybeRewriteToolParams(
    "cm_ctx_execute",
    { language: "shell", code: "git status", timeout: 1000 },
    DEFAULT_RTK_CONFIG,
    { exec: () => "should not run" },
  );

  assert.equal(params, null);
}

{
  const params = maybeRewriteToolParams(
    "cm_ctx_batch_execute",
    {
      commands: [{ label: "git", command: "git status" }],
      queries: ["status"],
    },
    DEFAULT_RTK_CONFIG,
    { exec: () => "should not run" },
  );

  assert.equal(params, null);
}

{
  const params = maybeRewriteToolParams(
    "read",
    { path: "README.md" },
    DEFAULT_RTK_CONFIG,
    { exec: () => "should not run" },
  );

  assert.equal(params, null);
}

console.log("handler tests passed");
