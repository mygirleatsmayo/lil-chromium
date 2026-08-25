// LILFOCUS replay (issue #30).
//
// Proves end to end that the one documented command reports the two reported
// symptoms RED from a stored trace — the whole path, not just the oracle:
// record stream -> repetition grouping -> per-scenario verdict -> overall.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readTrace, replay, replayRecords } from "./replay.mjs";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/focus-loop/synthetic-v04-symptoms.jsonl"
);

test("a trace carrying both v0.4 symptoms replays red, scenario by scenario", () => {
  const result = replay(FIXTURE, { bundleId: "net.imput.helium" });
  const by = Object.fromEntries(result.scenarios.map((s) => [s.scenario, s]));

  assert.equal(result.overall, "red");
  assert.deepEqual(result.counts, { red: 2, green: 1, inconclusive: 0 });

  // Symptom 1: closing a focused lil lands on a Helium sibling, every time.
  assert.equal(by["close/immediate"].verdict, "red");
  assert.equal(by["close/immediate"].rate, 1);
  assert.match(by["close/immediate"].repetitions[0].reason, /net\.imput\.helium/);

  // Symptom 2: opening raises an unrelated sibling — intermittently, so the
  // reproduction rate is what a downstream fix has to move.
  assert.equal(by["open/cross-display/no-other-lil"].verdict, "red");
  assert.equal(by["open/cross-display/no-other-lil"].reproductions, 1);
  assert.equal(by["open/cross-display/no-other-lil"].repetitions.length, 3);

  // …and correct behaviour still reads green, so the loop is not stuck red.
  assert.equal(by["open/same-display/lil-on-primary-display"].verdict, "green");
});

test("replay reaches the same verdict as the run that recorded the trace", () => {
  const a = replay(FIXTURE, { bundleId: "net.imput.helium" });
  const b = replay(FIXTURE, { bundleId: "net.imput.helium" });
  assert.deepEqual(a, b, "the verdict is deterministic");
  assert.equal(a.replayOf, "synthetic-v04-symptoms.jsonl");
});

test("a trace with no extension records still scores from the native reading", () => {
  const records = readTrace(FIXTURE).filter((r) => r.source !== "extension");
  const result = replayRecords(records, { bundleId: "net.imput.helium" });
  const by = Object.fromEntries(result.scenarios.map((s) => [s.scenario, s]));

  // Same verdicts as the instrumented trace: the seam explains, it does not decide.
  assert.equal(result.overall, "red");
  assert.equal(by["close/immediate"].verdict, "red");
  assert.equal(by["open/cross-display/no-other-lil"].verdict, "red");
  assert.equal(by["open/cross-display/no-other-lil"].reproductions, 1);
  assert.equal(by["open/same-display/lil-on-primary-display"].verdict, "green");
  assert.equal(by["open/cross-display/no-other-lil"].repetitions[0].identifiedBy, "native");
});
