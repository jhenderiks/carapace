import { strict as assert } from "node:assert";

import {
  checkRtk,
  maybeRewriteToolParams,
  normalizeRtkPluginConfig,
  tryRewrite,
} from "./handler.js";

assert.deepEqual(normalizeRtkPluginConfig(undefined), {
  enabled: true,
  verbose: false,
});

assert.deepEqual(normalizeRtkPluginConfig({ enabled: false, verbose: true }), {
  enabled: false,
  verbose: true,
});

assert.equal(
  checkRtk((file, args) => {
    assert.equal(file, "rtk");
    assert.deepEqual(args, ["--version"]);
    return "rtk 0.37.0";
  }),
  true,
);

assert.equal(
  checkRtk(() => {
    throw new Error("missing");
  }),
  false,
);

assert.equal(
  tryRewrite("git status", (file, args) => {
    assert.equal(file, "rtk");
    assert.deepEqual(args, ["rewrite", "git status"]);
    return "rtk git status\n";
  }),
  "rtk git status",
);

assert.equal(tryRewrite("git status", () => "git status"), null);

assert.equal(
  tryRewrite("git status", () => {
    throw new Error("boom");
  }),
  null,
);

{
  const params = maybeRewriteToolParams(
    "exec",
    { command: "git status", workdir: "/tmp" },
    () => "rtk git status",
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
    () => "git status",
  );

  assert.equal(params, null);
}

{
  const params = maybeRewriteToolParams(
    "cm_ctx_execute",
    { language: "shell", code: "git status", timeout: 1000 },
    () => "should not run",
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
    () => "should not run",
  );

  assert.equal(params, null);
}

{
  const params = maybeRewriteToolParams(
    "read",
    { path: "README.md" },
    () => "should not run",
  );

  assert.equal(params, null);
}

console.log("handler tests passed");
