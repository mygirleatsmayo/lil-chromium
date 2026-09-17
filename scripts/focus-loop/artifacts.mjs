// LILFOCUS artifacts (issue #30).
//
// What a run leaves behind and what it prints. The verdict itself is never
// computed here — `foldRun` in verdict.mjs decides, for a live run and a replay
// alike, and this module only shapes and reports the result.

import fs from "node:fs";
import path from "node:path";

import { environment } from "./native.mjs";
import { foldRun } from "./verdict.mjs";

/** The summary a run writes, and the one a replay is compared against. */
export function summarize({ repoRoot, opts, runId, results, seamLive }) {
  return {
    tag: "LILFOCUS",
    issue: 30,
    runId,
    startedAt: new Date().toISOString(),
    environment: environment(repoRoot, opts),
    settings: {
      browser: opts.browser,
      bundleId: opts.bundleId,
      sourceApp: opts.sourceApp,
      switchApp: opts.switchApp,
      url: opts.url,
      settleMs: opts.settleMs,
    },
    seamLive,
    ...foldRun(results),
  };
}

export function writeArtifacts(outDir, runId, records, summary) {
  fs.mkdirSync(outDir, { recursive: true });
  const trace = path.join(outDir, `trace-${runId}.jsonl`);
  const verdict = path.join(outDir, `verdict-${runId}.json`);
  fs.writeFileSync(trace, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(verdict, JSON.stringify(summary, null, 2) + "\n");
  return { trace, verdict };
}

export function printSummary(summary) {
  process.stdout.write("\n--- LILFOCUS verdict ---\n");
  for (const s of summary.scenarios) {
    const rate = s.repetitions && s.repetitions.length ? ` (${s.reproductions}/${s.repetitions.length})` : "";
    process.stdout.write(`  ${s.verdict.padEnd(12)} ${s.scenario}${rate}\n`);
  }
  process.stdout.write(`  overall: ${summary.overall}\n`);
}

/** 0 green · 1 reproduced · 2 unscoreable · 3 preflight (raised by the caller). */
export function exitCode(summary) {
  if (summary.overall === "red") return 1;
  if (summary.overall === "inconclusive") return 2;
  return 0;
}
