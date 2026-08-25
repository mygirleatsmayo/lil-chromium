// LILFOCUS replay (issue #30).
//
// Re-scores a recorded trace with the same pure verdict engine the live run
// uses, so a stored artifact reaches the same conclusion without repeating a
// single gesture. That is what makes the loop fast, deterministic, and
// agent-runnable — and what lets #31 and #32 check a fix against the recorded
// symptom before booking anyone's Mac.
//
// This module owns only the trace format: reading records back and grouping
// them into repetitions. Every judgement is `verdict.mjs`.

import fs from "node:fs";
import path from "node:path";

import { SCENARIOS } from "./scenarios.mjs";
import { foldRun, scoreRepetition } from "./verdict.mjs";

export function readTrace(traceFile) {
  return fs
    .readFileSync(traceFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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

  const entries = [...perScenario.entries()].map(([scenario, repetitions]) => ({
    scenario,
    kind: (SCENARIOS.find((s) => s.id === scenario) || {}).kind,
    repetitions,
  }));
  return { tag: "LILFOCUS", issue: 30, ...foldRun(entries) };
}

export function replay(traceFile, { bundleId }) {
  return { ...replayRecords(readTrace(traceFile), { bundleId }), replayOf: path.basename(traceFile) };
}
