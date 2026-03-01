import { strict as assert } from "node:assert";

import { applyRtkRouting, DEFAULT_RTK_CONFIG } from "./routing.js";

const config = {
  ...DEFAULT_RTK_CONFIG,
  binary: "rtk",
};

// --- existing baseline tests ---
assert.equal(applyRtkRouting("ls -la", config), "rtk ls -la");
assert.equal(applyRtkRouting("tree .", config), "rtk tree .");

assert.equal(applyRtkRouting("git status", config), "rtk git status");
assert.equal(applyRtkRouting("git checkout main", config), null);

assert.equal(applyRtkRouting("cat foo.txt", config), "rtk read foo.txt");
assert.equal(applyRtkRouting("cat", config), null);

assert.equal(applyRtkRouting("rtk ls -la", config), null);
assert.equal(applyRtkRouting("gh api /repos", config), null);

assert.equal(applyRtkRouting("FOO=bar git status", config), "FOO=bar rtk git status");

assert.equal(applyRtkRouting("ls -la | grep foo", config), "rtk ls -la | grep foo");
assert.equal(applyRtkRouting("cat <<EOF\nfoo\nEOF", config), null);

// --- grep flag reordering ---
// splitCommand preserves quotes, so 'foo' stays as 'foo' in the output
assert.equal(applyRtkRouting("grep -r 'foo' /path", config), "rtk grep 'foo' /path -r");
assert.equal(applyRtkRouting("grep -v pattern file", config), "rtk grep pattern file --invert-match");
assert.equal(applyRtkRouting("grep -c pattern file", config), null); // -c falls back
assert.equal(applyRtkRouting("grep -l pattern file", config), null); // -l falls back
assert.equal(applyRtkRouting("rg pattern src/", config), "rtk grep pattern src/");

// --- head variants ---
assert.equal(applyRtkRouting("head -20 file.txt", config), "rtk read file.txt --max-lines 20");
assert.equal(applyRtkRouting("head -n 5 file.txt", config), "rtk read file.txt --max-lines 5");
assert.equal(applyRtkRouting("head --lines=10 file.txt", config), "rtk read file.txt --max-lines 10");
assert.equal(applyRtkRouting("head", config), null); // no args

// --- npm routing ---
assert.equal(applyRtkRouting("npm test", config), "rtk npm test");
assert.equal(applyRtkRouting("npm run build", config), "rtk npm build");
assert.equal(applyRtkRouting("npm install foo", config), null); // not intercepted

// --- git commit edge cases ---
assert.equal(applyRtkRouting("git commit -m 'msg'", config), "rtk git commit -m 'msg'");
assert.equal(applyRtkRouting("git commit --amend", config), null); // --amend not allowed
assert.equal(applyRtkRouting("git commit -am 'msg'", config), null); // -a flag not allowed

// --- npx/pnpm ---
assert.equal(applyRtkRouting("npx vitest test", config), "rtk vitest run test");
assert.equal(applyRtkRouting("npx tsc --noEmit", config), "rtk tsc --noEmit");
assert.equal(applyRtkRouting("npx unknown-tool", config), null);

// --- docker ---
assert.equal(applyRtkRouting("docker ps -a", config), "rtk docker ps -a");
assert.equal(applyRtkRouting("docker run nginx", config), null);

// --- cargo ---
assert.equal(applyRtkRouting("cargo test --release", config), "rtk cargo test --release");
assert.equal(applyRtkRouting("cargo add serde", config), null);

// --- eslint remap (eslint removed from allIntercept, routes via remapped → lint) ---
assert.equal(applyRtkRouting("eslint src", config), "rtk lint src");

// --- find ---
assert.equal(applyRtkRouting("find pattern", config), "rtk find pattern");
assert.equal(applyRtkRouting("find /tmp", config), null); // absolute path = native find
assert.equal(applyRtkRouting("find . -name '*.ts'", config), null); // starts with . = native find

// --- disabled config ---
assert.equal(applyRtkRouting("ls", { ...config, enabled: false }), null);

// --- env prefix with multiple vars ---
assert.equal(applyRtkRouting("A=1 B=2 ls -la", config), "A=1 B=2 rtk ls -la");

console.log("All tests passed.");
