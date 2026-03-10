import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";

import { applyRtkRouting, normalizeRtkConfig, DEFAULT_RTK_CONFIG } from "./routing.js";

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
// applyRtkRouting — unit-testable guards (no subprocess needed)
// ---------------------------------------------------------------------------

assert.equal(applyRtkRouting("ls", { ...DEFAULT_RTK_CONFIG, enabled: false }), null);
assert.equal(applyRtkRouting("", DEFAULT_RTK_CONFIG), null);
assert.equal(applyRtkRouting(42 as unknown as string, DEFAULT_RTK_CONFIG), null);

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

  // basic intercept — rtk rewrite should transform these
  const lsResult = applyRtkRouting("ls -la", config);
  assert.ok(lsResult !== null, "expected rtk to rewrite 'ls -la'");
  assert.ok(lsResult.includes("rtk"), `expected rewritten command to contain 'rtk', got: ${lsResult}`);

  // already-rtk command should come back unchanged → null
  assert.equal(applyRtkRouting("rtk ls -la", config), null);

  console.log("All tests passed (with integration tests).");
} else {
  console.log("All tests passed (rtk binary not available, integration tests skipped).");
}
