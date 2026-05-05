import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";

import { applyRtkRouting, normalizeRtkConfig, DEFAULT_RTK_CONFIG } from "./routing.ts";
import type { RewriteOptions } from "./routing.ts";

// ---------------------------------------------------------------------------
// normalizeRtkConfig
// ---------------------------------------------------------------------------

const defaults = normalizeRtkConfig(undefined);
assert.equal(defaults.enabled, true);
assert.equal(defaults.binary, "/usr/local/bin/rtk");

const custom = normalizeRtkConfig({ enabled: false, binary: "/opt/bin/rtk" });
assert.equal(custom.enabled, false);
assert.equal(custom.binary, "/opt/bin/rtk");

const partial = normalizeRtkConfig({ enabled: true });
assert.equal(partial.binary, "/usr/local/bin/rtk");

const badTypes = normalizeRtkConfig({ enabled: "yes", binary: 42 });
assert.equal(badTypes.enabled, true); // fallback
assert.equal(badTypes.binary, "/usr/local/bin/rtk"); // fallback

const emptyBinary = normalizeRtkConfig({ binary: "" });
assert.equal(emptyBinary.binary, "/usr/local/bin/rtk"); // fallback

// ---------------------------------------------------------------------------
// applyRtkRouting — guards (no subprocess needed)
// ---------------------------------------------------------------------------

assert.equal(applyRtkRouting("ls", { ...DEFAULT_RTK_CONFIG, enabled: false }), null);
assert.equal(applyRtkRouting("", DEFAULT_RTK_CONFIG), null);
assert.equal(applyRtkRouting(42 as unknown as string, DEFAULT_RTK_CONFIG), null);

// ---------------------------------------------------------------------------
// applyRtkRouting — subprocess plumbing (mocked exec)
// ---------------------------------------------------------------------------

{
  // captures the binary and args passed to exec
  const calls: Array<{ binary: string; args: string[] }> = [];
  const mockExec = (binary: string, args: string[]): string => {
    calls.push({ binary, args });
    return "rtk ls -la\n";
  };

  const config = { ...DEFAULT_RTK_CONFIG, binary: "/usr/local/bin/rtk" };
  const result = applyRtkRouting("ls -la", config, { exec: mockExec });

  assert.equal(result, "rtk ls -la");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.binary, "/usr/local/bin/rtk");
  assert.deepEqual(calls[0]!.args, ["rewrite", "ls -la"]);
}

{
  // uses custom binary path from config
  const calls: Array<{ binary: string; args: string[] }> = [];
  const mockExec = (binary: string, args: string[]): string => {
    calls.push({ binary, args });
    return "rtk git status\n";
  };

  const config = { enabled: true, binary: "/opt/bin/rtk" };
  applyRtkRouting("git status", config, { exec: mockExec });

  assert.equal(calls[0]!.binary, "/opt/bin/rtk");
}

{
  // returns null when rewritten output matches input (no-op rewrite)
  const mockExec = (): string => "git checkout main";
  const config = { ...DEFAULT_RTK_CONFIG };
  const result = applyRtkRouting("git checkout main", config, { exec: mockExec });

  assert.equal(result, null);
}

{
  // returns null when exec returns empty string
  const mockExec = (): string => "";
  const config = { ...DEFAULT_RTK_CONFIG };
  const result = applyRtkRouting("some-command", config, { exec: mockExec });

  assert.equal(result, null);
}

{
  // returns null and calls onError when exec throws
  const errors: unknown[] = [];
  const mockExec = (): string => {
    throw new Error("binary not found");
  };

  const config = { ...DEFAULT_RTK_CONFIG };
  const result = applyRtkRouting("ls", config, {
    exec: mockExec,
    onError: (err) => errors.push(err),
  });

  assert.equal(result, null);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof Error);
  assert.equal((errors[0] as Error).message, "binary not found");
}

{
  // returns null without calling onError when exec throws and no handler provided
  const mockExec = (): string => {
    throw new Error("crash");
  };

  const config = { ...DEFAULT_RTK_CONFIG };
  const result = applyRtkRouting("ls", config, { exec: mockExec });

  assert.equal(result, null);
}

{
  // trims whitespace from rewritten output
  const mockExec = (): string => "  rtk ls -la  \n";
  const config = { ...DEFAULT_RTK_CONFIG };
  const result = applyRtkRouting("ls -la", config, { exec: mockExec });

  assert.equal(result, "rtk ls -la");
}

// ---------------------------------------------------------------------------
// applyRtkRouting — integration tests (require `rtk` binary on PATH)
// ---------------------------------------------------------------------------

let hasRtk = false;
try {
  execFileSync("rtk", ["--version"], { stdio: "ignore" });
  hasRtk = true;
} catch {}

if (hasRtk) {
  const config = { ...DEFAULT_RTK_CONFIG, binary: "rtk" };

  // basic intercept
  const lsResult = applyRtkRouting("ls -la", config);
  assert.ok(lsResult !== null, "expected rtk to rewrite 'ls -la'");
  assert.ok(lsResult.includes("rtk"), `expected rewritten command to contain 'rtk', got: ${lsResult}`);

  // already-rtk command should come back unchanged
  assert.equal(applyRtkRouting("rtk ls -la", config), null);

  console.log("All tests passed (with integration tests).");
} else {
  console.log("All tests passed (rtk binary not available, integration tests skipped).");
}
