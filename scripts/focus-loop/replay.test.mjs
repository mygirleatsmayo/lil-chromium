// LILFOCUS replay (issue #30).
//
// Proves end to end that the one documented command reports the two reported
// symptoms RED from a stored trace — the whole path, not just the oracle:
// record stream -> repetition grouping -> per-scenario verdict -> overall.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { foldRun } from "./verdict.mjs";
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
  const crossDisplay = by["open/cross-display/no-other-lil"];
  assert.equal(crossDisplay.verdict, "red");
  assert.equal(crossDisplay.reproductions, 2);
  assert.equal(crossDisplay.repetitions.length, 3);
  assert.match(crossDisplay.repetitions[0].reason, /came forward with the lil/);
  // …including the arrangement that used to read green: nothing overtook
  // anything, but the lil landed on the Primary window's display, not Mail's.
  assert.equal(crossDisplay.repetitions[1].verdict, "green");
  assert.deepEqual(crossDisplay.repetitions[2].risenSiblings, []);
  assert.match(crossDisplay.repetitions[2].reason, /display 0 instead of the source application's display 1/);

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
  assert.equal(by["open/cross-display/no-other-lil"].reproductions, 2);
  assert.equal(by["open/same-display/lil-on-primary-display"].verdict, "green");
  assert.equal(by["open/cross-display/no-other-lil"].repetitions[0].identifiedBy, "native");
});

test("a green open whose teardown failed replays inconclusive, matching the live run", () => {
  const all = readTrace(FIXTURE);
  const start = all.findIndex(
    (r) => r.event === "repetition-begin" && r.detail && r.detail.scenario === "open/same-display/lil-on-primary-display"
  );
  const end = all.findIndex((r, i) => i > start && r.event === "repetition-begin");
  const records = all.slice(start, end).map((r) =>
    r.event === "harness-close" ? { ...r, detail: { ...r.detail, outcome: "close-failed" } } : r
  );
  records.push({
    tag: "LILFOCUS",
    source: "harness",
    t: records[records.length - 1].t + 1,
    event: "repetition-verdict",
    detail: { repetition: 1, verdict: "green", teardown: "close-failed" },
  });

  const result = replayRecords(records, { bundleId: "net.imput.helium" });
  const scenario = result.scenarios[0];
  const live = foldRun([
    {
      scenario: "open/same-display/lil-on-primary-display",
      kind: "open",
      repetitions: [
        { repetition: 1, verdict: "green", teardown: "close-failed" },
        {
          repetition: 2,
          verdict: "inconclusive",
          reason: 'teardown reported "close-failed", so the confirmed arrangement no longer holds',
        },
      ],
    },
  ]);

  assert.equal(result.overall, "inconclusive", "must not replay the measured green as the whole run");
  assert.deepEqual(result.counts, live.counts);
  assert.equal(scenario.verdict, "inconclusive");
  assert.equal(scenario.repetitions.length, 2);
  assert.equal(scenario.repetitions[0].verdict, "green");
  assert.equal(scenario.repetitions[1].verdict, "inconclusive");
  assert.equal(
    scenario.repetitions[1].reason,
    'teardown reported "close-failed", so the confirmed arrangement no longer holds'
  );
});
