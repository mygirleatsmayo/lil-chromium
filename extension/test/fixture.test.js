import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fixture, fixtureBytes, fixtureDirectory } from "./fixture.js";

const SHARED = [
  "config-v1-legacy",
  "config-v2-complete",
  "config-with-unknown-fields",
  "message-context",
  "message-history-result",
  "message-open-legacy",
  "message-pong-legacy",
];

test("fixture directory is repo-root fixtures, resolved from this file", () => {
  const dir = fixtureDirectory();
  assert.equal(path.basename(dir), "fixtures");
  // Independent landmarks: this is the repo-root set, not a copy beside the tests.
  assert.ok(fs.existsSync(path.join(dir, "..", "extension", "background.js")));
  assert.ok(fs.existsSync(path.join(dir, "..", "mac", "Package.swift")));
  assert.ok(fs.existsSync(path.join(dir, "..", "docs", "PROTOCOL.md")));
  for (const name of SHARED) {
    assert.ok(fs.existsSync(path.join(dir, `${name}.json`)), name);
  }
});

test("fixtures still resolve when cwd is not the repo root", () => {
  const original = process.cwd();
  process.chdir(os.tmpdir());
  try {
    const ctx = fixture("message-context");
    assert.equal(ctx.type, "context");
    assert.equal(ctx.browser, "brave");
  } finally {
    process.chdir(original);
  }
});

test("fixture path does not depend on HOME", () => {
  const previous = process.env.HOME;
  process.env.HOME = path.join(os.tmpdir(), "not-the-repo");
  try {
    const dir = fixtureDirectory();
    assert.equal(dir.startsWith(process.env.HOME + path.sep), false);
    assert.ok(fs.existsSync(path.join(dir, "message-context.json")));
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
  }
});

test("every shared contract fixture is readable as the same JSON object", () => {
  for (const name of SHARED) {
    const bytes = fixtureBytes(name);
    assert.ok(bytes.length > 0, name);
    const parsed = JSON.parse(bytes.toString("utf8"));
    assert.equal(typeof parsed, "object");
    assert.deepEqual(fixture(name), parsed);
  }
});
