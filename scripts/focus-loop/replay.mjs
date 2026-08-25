// LILFOCUS replay (issue #30).
//
// Re-scores a recorded trace with the same pure verdict engine the live run
// uses, so a stored artifact reaches the same conclusion without repeating a
// single gesture. That is what makes the loop fast, deterministic, and
// agent-runnable — and what lets #31 and #32 check a fix against the recorded
// symptom before booking anyone's Mac.

import fs from "node:fs";
import path from "node:path";

import { SCENARIOS } from "./scenarios.mjs";
import { closeVerdict, openVerdict, scenarioVerdict } from "./verdict.mjs";

export function readTrace(traceFile) {
  return fs
    .readFileSync(traceFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Score one repetition's collected probes and creations.
 *
 * The native reading alone decides the verdict, so the loop still scores a
 * browser running an uninstrumented build — the extension's own report of what
 * it created only sharpens which new window was the lil when several appeared.
 */
export function scoreRepetition({ scenario, probes, created, bundleId }) {
  const kind = (scenario && scenario.kind) || "open";
  const needed = kind === "open" ? ["before", "after"] : ["before", "afterClose"];
  const missing = needed.filter((label) => !probes[label]);
  if (missing.length) {
    return { verdict: "inconclusive", reason: `missing native reading(s): ${missing.join(", ")}` };
  }

  const lastCreated = created[created.length - 1] || null;
  if (kind === "open") {
    return {
      identifiedBy: lastCreated ? "extension" : "native",
      ...openVerdict({
        before: probes.before,
        after: probes.after,
        bundleId,
        createdBounds: lastCreated && lastCreated.bounds,
      }),
    };
  }

  const expectedFrom = (scenario && scenario.expectedFrom) || "before";
  const expected = probes[expectedFrom];
  return closeVerdict({
    before: probes.before,
    after: probes.afterClose,
    bundleId,
    expectedBundleId: expected && expected.frontmost && expected.frontmost.bundleId,
  });
}

/** Fold a whole trace into the same summary shape a live run writes. */
export function replayRecords(records, { bundleId }) {
  const perScenario = new Map();
  let current = null;
  let probes = {};
  let created = [];

  const flush = () => {
    if (!current) return;
    const scenario = SCENARIOS.find((s) => s.id === current.scenario) || null;
    const result = scoreRepetition({ scenario, probes, created, bundleId });
    const list = perScenario.get(current.scenario) || [];
    list.push({ repetition: current.repetition, ...result });
    perScenario.set(current.scenario, list);
  };

  for (const rec of records) {
    if (rec.event === "repetition-begin") {
      flush();
      current = rec.detail;
      probes = {};
      created = [];
    } else if (rec.source === "probe") {
      probes[rec.label] = rec;
    } else if (rec.source === "extension" && rec.event === "lil-created") {
      created.push(rec.detail);
    }
  }
  flush();

  const scenarios = [...perScenario.entries()].map(([id, reps]) => ({
    scenario: id,
    kind: (SCENARIOS.find((s) => s.id === id) || {}).kind,
    ...scenarioVerdict(reps),
    repetitions: reps,
  }));
  const counts = { red: 0, green: 0, inconclusive: 0 };
  for (const s of scenarios) counts[s.verdict]++;

  return {
    tag: "LILFOCUS",
    issue: 30,
    counts,
    overall: counts.red ? "red" : counts.inconclusive ? "inconclusive" : "green",
    scenarios,
  };
}

export function replay(traceFile, { bundleId }) {
  return { ...replayRecords(readTrace(traceFile), { bundleId }), replayOf: path.basename(traceFile) };
}
