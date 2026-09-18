#!/usr/bin/env node
// LILFOCUS — the real-Mac focus loop for issue #30.
//
//   node scripts/focus-loop.mjs run              # score the whole #30 matrix
//   node scripts/focus-loop.mjs replay <trace>   # re-score a recorded run
//   node scripts/focus-loop.mjs cleanup          # disarm + prove nothing is armed
//
// This file owns the command and the run: parsing, preflight, walking a
// scenario's steps, and tearing down after itself. Everything it talks to lives
// behind one module each — `channel.mjs` (the extension), `native.mjs` (macOS),
// `verdict.mjs` (the oracle), `artifacts.mjs` (what a run leaves behind).
//
// It reads three views of the same moment and writes them into one trace:
//
//   native      `lil-focus-probe` — the frontmost application and every
//               on-screen window in front-to-back order (public CoreGraphics;
//               no Accessibility permission, no private API).
//   extension   the LILFOCUS seam in extension/focus-trace.js — window identity,
//               type, focus state, the app-supplied and chosen prior contexts,
//               focus events, and the close-time restoration target.
//   host        `[LILFOCUS]` lines in ~/.lilchromium/host-<slug>.log — the open
//               the app sent, the restore-focus it received, what activation
//               returned, and the application that actually ended up in front.
//
// Everything the harness can do itself, it does: activating an application and
// opening a lil go through the real product path (`/usr/bin/open`, the default
// browser, the relay). The only steps left to a person are the gestures macOS
// gives no permission-free way to perform — pressing ⌘W and clicking a window's
// red close control — and the run *watches* for those rather than asking for a
// keystroke afterwards, because a keystroke is itself a focus change.
//
// See .mayosdd/tickets/evidence/issue-30-real-mac-focus-loop/README.md.

import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { disarmRelay, openChannel, relayIsUp, socketPath } from "./focus-loop/channel.mjs";
import { activateApp, hostLogTail, openLilThroughProduct, probe, probeBinary } from "./focus-loop/native.mjs";
import { exitCode, printSummary, summarize, writeArtifacts } from "./focus-loop/artifacts.mjs";
import { gestures, needsOperator, selectScenarios } from "./focus-loop/scenarios.mjs";
import { replay } from "./focus-loop/replay.mjs";
import { browserLayout, displayOfApp, scoreRepetition, teardownInconclusive } from "./focus-loop/verdict.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const DEFAULT_OUT = path.join(REPO_ROOT, ".mayosdd/tickets/evidence/issue-30-real-mac-focus-loop");
const TAG = "LILFOCUS";

const DEFAULTS = {
  browser: "helium",
  bundleId: "net.imput.helium",
  sourceApp: "com.apple.mail",
  switchApp: "md.obsidian",
  url: "https://example.com/",
  port: 8931,
  // Window-server settling. macOS activation and window ordering are
  // asynchronous, so an immediate reading reports the state before the gesture.
  settleMs: 900,
  // How long one operator gesture may take before the repetition is unscored.
  gestureTimeoutMs: 120_000,
};

const ARM_TTL_MS = 20 * 60 * 1000;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { command: "run", ...DEFAULTS, out: DEFAULT_OUT, scenarios: null, reps: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }
    const [flag, inline] = arg.slice(2).split("=");
    const value = inline !== undefined ? inline : argv[++i];
    switch (flag) {
      case "scenarios": opts.scenarios = value; break;
      case "reps": opts.reps = Number(value); break;
      case "out": opts.out = path.resolve(value); break;
      case "browser": opts.browser = value; break;
      case "bundle-id": opts.bundleId = value; break;
      case "source-app": opts.sourceApp = value; break;
      case "switch-app": opts.switchApp = value; break;
      case "url": opts.url = value; break;
      case "port": opts.port = Number(value); break;
      case "settle-ms": opts.settleMs = Number(value); break;
      case "gesture-timeout-ms": opts.gestureTimeoutMs = Number(value); break;
      case "help": opts.command = "help"; break;
      default: throw new Error(`unknown flag --${flag}`);
    }
  }
  if (rest.length && opts.command !== "help") {
    opts.command = rest[0];
    opts.traceFile = rest[1];
  }
  return opts;
}

const USAGE = `LILFOCUS focus loop (issue #30)

  node scripts/focus-loop.mjs run [flags]
  node scripts/focus-loop.mjs replay <trace.jsonl>
  node scripts/focus-loop.mjs cleanup

Flags
  --scenarios <csv>    id or prefix filter, e.g. "open/" or "close/immediate"
  --reps <n>           override the per-scenario repetition count
  --source-app <id>    bundle id a lil is opened from   (default ${DEFAULTS.sourceApp})
  --switch-app <id>    bundle id switched to mid-scenario (default ${DEFAULTS.switchApp})
  --browser <slug>     relay slug                       (default ${DEFAULTS.browser})
  --bundle-id <id>     that browser's bundle id         (default ${DEFAULTS.bundleId})
  --url <url>          URL each lil opens               (default ${DEFAULTS.url})
  --port <n>           local collector port             (default ${DEFAULTS.port})
  --settle-ms <n>      window-server settle wait        (default ${DEFAULTS.settleMs})
  --gesture-timeout-ms <n>  how long one gesture may take (default ${DEFAULTS.gestureTimeoutMs})
  --out <dir>          artifact directory

Exit status: 0 = every scenario green, 1 = at least one reproduced (red),
2 = a scenario could not be scored, 3 = preflight failed.`;

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Run {
  constructor(opts, channel) {
    this.opts = opts;
    this.channel = channel;
    this.runId = opts.runId;
    this.records = [];
    // Every lil this run opened that is still open. The only windows it is
    // allowed to close, and the list the final sweep has to empty.
    this.openedLils = new Set();
    this.drainHostLog = hostLogTail(opts.browser);
    this.rl = process.stdin.isTTY
      ? readline.createInterface({ input: process.stdin, output: process.stdout })
      : null;
  }

  record(event, detail, source = "harness") {
    const rec = { tag: TAG, runId: this.runId, source, t: Date.now(), event, detail };
    this.records.push(rec);
    return rec;
  }

  /** One record from the extension's collector. */
  collect(rec) {
    this.records.push(rec);
    const windowId = rec && rec.detail && rec.detail.windowId;
    if (rec.source !== "extension" || !Number.isInteger(windowId)) return;
    if (rec.event === "lil-created") this.openedLils.add(windowId);
    if (rec.event === "window-removed") this.openedLils.delete(windowId);
  }

  /** Wait for a record matching `match`, appended after `from`. */
  async waitFor(match, timeoutMs, from = this.records.length) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.records.slice(from).find(match);
      if (hit) return hit;
      await sleep(50);
    }
    return null;
  }

  /** The extension's window list, requested on demand and awaited by label. */
  async extensionWindows(label) {
    const from = this.records.length;
    await this.channel.snapshot(label);
    const hit = await this.waitFor(
      (r) => r.source === "extension" && r.event === "windows" && r.detail && r.detail.label === label,
      2000,
      from
    );
    return hit ? hit.detail.windows : null;
  }

  /**
   * Everything that must hold before the run is allowed to touch a window.
   *
   * The seam check is part of preflight, not of the first scenario: a run
   * without it can open a lil it has no safe way to close, which is how an
   * earlier run left an unowned lil on Lucas's screen. Arming changes nothing
   * on screen, so this costs no mutation.
   */
  async preflight() {
    const problems = [];
    if (process.platform !== "darwin") problems.push("this loop only means anything on macOS");
    if (!relayIsUp(this.opts.browser)) {
      problems.push(
        `no relay socket at ${socketPath(this.opts.browser)} — is ${this.opts.browser} running with the extension loaded?`
      );
    }
    if (problems.length) return problems;

    await this.channel.arm(ARM_TTL_MS).catch((err) => problems.push(`could not reach the relay: ${err.message}`));
    if (problems.length) return problems;

    const armed = await this.waitFor((r) => r.source === "extension", 3000, 0);
    if (!armed) {
      problems.push(
        "the running browser carries no live LILFOCUS seam, so this run could open a lil it cannot close.\n" +
          "            Load extension/ from this worktree and reload it, then run again."
      );
    }
    this.record("seam", { live: !!armed, endpoint: this.channel.endpoint });
    return problems;
  }

  async ask(prompt) {
    if (!this.rl) throw new Error("this scenario needs an operator, but stdin is not a terminal");
    process.stdout.write("\n");
    await this.rl.question(`  >>> ${prompt}\n      [Enter when done] `);
  }

  /**
   * Name the one gesture only a person can make, then watch the seam for it.
   * No keystroke follows: pressing Enter in a terminal activates the terminal,
   * which would land between the gesture and the reading that scores it.
   */
  async awaitGesture(step, lilWindowId) {
    if (!Number.isInteger(lilWindowId)) return "no lil was created to act on";
    const from = this.records.length;
    process.stdout.write(`\n  >>> ${step.prompt}\n      (waiting for it — no keystroke, do not touch this terminal)\n`);

    const wanted = step.until === "lil-focused" ? "focus-changed" : "window-removed";
    const hit = await this.waitFor(
      (r) => r.source === "extension" && r.event === wanted && r.detail && r.detail.windowId === lilWindowId,
      this.opts.gestureTimeoutMs,
      from
    );
    this.record("gesture", { until: step.until, windowId: lilWindowId, observed: !!hit });
    return hit ? null : `the gesture "${step.until}" was not observed within ${this.opts.gestureTimeoutMs}ms`;
  }

  /** Run one step and read the screen after it. Returns a reason on failure. */
  async runStep(scenario, step, probes, state) {
    if (step.do === "activate") {
      await activateApp(step.app === "switch" ? this.opts.switchApp : this.opts.sourceApp);
    } else if (step.do === "open") {
      await openLilThroughProduct(this.opts.url, scenario.launch);
    } else if (step.do === "await") {
      const problem = await this.awaitGesture(step, state.lilWindowId);
      if (problem) return problem;
    }
    await sleep(this.opts.settleMs);
    const snapshot = await probe(this.probe, step.probe);
    this.records.push({ ...snapshot, runId: this.runId, step: step.do });
    probes[step.probe] = snapshot;
    for (const rec of this.drainHostLog()) this.records.push({ ...rec, runId: this.runId });

    state.created = this.records
      .slice(state.from)
      .filter((r) => r.source === "extension" && r.event === "lil-created")
      .map((r) => r.detail);
    const last = state.created[state.created.length - 1];
    if (last) state.lilWindowId = last.windowId;
    return null;
  }

  /**
   * Close one lil this run opened. The seam refuses anything else, and the
   * outcome it reports back is what the run trusts — never the request.
   */
  async tearDown(windowId) {
    if (!Number.isInteger(windowId) || !this.openedLils.has(windowId)) return "nothing-to-close";
    const from = this.records.length;
    await this.channel.closeLil(windowId);
    const hit = await this.waitFor(
      (r) => r.source === "extension" && r.event === "harness-close" && r.detail.windowId === windowId,
      4000,
      from
    );
    await sleep(this.opts.settleMs);
    for (const rec of this.drainHostLog()) this.records.push({ ...rec, runId: this.runId });
    return hit ? hit.detail.outcome : "no-answer";
  }

  /** One repetition: walk the steps, score, tidy up after ourselves. */
  async runRepetition(scenario, index) {
    const probes = {};
    const state = { from: this.records.length, created: [], lilWindowId: null };
    this.record("repetition-begin", { scenario: scenario.id, repetition: index + 1 });

    let problem = null;
    for (const step of scenario.steps) {
      problem = await this.runStep(scenario, step, probes, state);
      if (problem) break;
    }

    const result = problem
      ? { verdict: "inconclusive", reason: problem }
      : scoreRepetition({ scenario, probes, created: state.created, bundleId: this.opts.bundleId });
    const rep = { repetition: index + 1, ...result, createdWindowId: state.lilWindowId };
    // Teardown, not measurement: an opening repetition leaves a lil behind, and
    // the next repetition must start from the arrangement that was confirmed.
    // Recorded on this verdict so replay can reconstruct a teardown stop.
    if (scenario.kind === "open") rep.teardown = await this.tearDown(state.lilWindowId);
    this.record("repetition-verdict", rep);
    this.report(rep);
    return rep;
  }

  report(rep) {
    const mark = { red: "RED  ", green: "green", inconclusive: "?????" }[rep.verdict];
    process.stdout.write(`      ${mark}  rep ${rep.repetition}: ${rep.reason}\n`);
  }

  /** Confirm the operator's arrangement matches the scenario before scoring it. */
  async confirmArrangement(scenario) {
    const source = this.opts.sourceApp;
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await probe(this.probe, `arrangement:${scenario.id}`);
      const extensionWindows = await this.extensionWindows(`arrangement:${scenario.id}`);
      const facts = {
        ...browserLayout(snapshot, extensionWindows || [], this.opts.bundleId),
        sourceDisplay: displayOfApp(snapshot, source),
      };
      const ok = !!extensionWindows && scenario.arrangement.check(facts) && scenario.neighbours.check(facts);
      this.record("arrangement-check", { scenario: scenario.id, facts, ok });
      if (ok) return true;
      if (!this.rl) return false;
      process.stdout.write(
        `\n  Arrangement needed:\n` +
          `    - ${scenario.arrangement.describe(source)}\n` +
          `    - ${scenario.neighbours.describe(source)}\n` +
          `  Observed: source display ${facts.sourceDisplay}, Primary display ${facts.primaryDisplay}, ` +
          `lils on displays [${facts.lilDisplays.join(", ")}]\n`
      );
      await this.ask("Adjust the windows to match, then press Enter.");
    }
    return false;
  }

  async execute(scenarios) {
    this.probe = probeBinary(REPO_ROOT);
    const baseline = await probe(this.probe, "baseline");
    this.records.push({ ...baseline, runId: this.runId });

    const results = [];
    for (const scenario of scenarios) {
      // The operator watches the screen, so the header says which launch they
      // are watching before the first gesture is asked for.
      process.stdout.write(`\n=== ${scenario.id}\n    ${scenario.summary}\n`);
      const skip = (reason) => results.push({ scenario: scenario.id, kind: scenario.kind, repetitions: [], reason });

      if (needsOperator(scenario) && !this.rl) {
        process.stdout.write(`      skipped: needs ${gestures(scenario).length} gesture(s) from a person at the Mac\n`);
        skip("no operator");
        continue;
      }
      if (scenario.arrangement && !(await this.confirmArrangement(scenario))) {
        skip("arrangement never matched");
        continue;
      }

      const repetitions = [];
      const count = this.opts.reps || scenario.defaultReps;
      for (let i = 0; i < count; i++) {
        const rep = await this.runRepetition(scenario, i);
        repetitions.push(rep);
        // A repetition whose lil is still open has changed the arrangement the
        // next one would be scored against, so the scenario stops here. The
        // teardown field on the recorded verdict is what replay consumes.
        const extra = teardownInconclusive(rep);
        if (extra) {
          repetitions.push(extra);
          break;
        }
      }
      results.push({ scenario: scenario.id, kind: scenario.kind, repetitions });
    }
    return results;
  }

  /** No run may leave a lil it opened behind. */
  async tearDownRemaining() {
    const left = [...this.openedLils];
    const stuck = [];
    for (const windowId of left) {
      if ((await this.tearDown(windowId)) !== "closed") stuck.push(windowId);
    }
    if (left.length) this.record("teardown-sweep", { attempted: left, stuck });
    if (stuck.length) {
      process.stderr.write(`\nWARNING: could not close lil window id(s) ${stuck.join(", ")} — close them by hand.\n`);
    }
    return stuck;
  }

  close() {
    if (this.rl) this.rl.close();
  }
}

// ---------------------------------------------------------------------------
// Cleanup — the one exact check the ticket asks for.
// ---------------------------------------------------------------------------

async function cleanup(opts) {
  let disarmed = "no relay socket (nothing can be armed)";
  if (relayIsUp(opts.browser)) {
    await disarmRelay(opts.browser);
    disarmed = `disarm sent to relay-${opts.browser}.sock`;
  }
  process.stdout.write(`${disarmed}\n`);
  process.stdout.write(
    "\nThe seam is retained deliberately (issue #30 allows either) and is a private\n" +
      "diagnostic control documented in docs/PROTOCOL.md. To see all of it:\n" +
      "  grep -rn LILFOCUS extension mac scripts docs\n" +
      "Nothing outside those tagged sites reads or writes it, and an armed run\n" +
      "expires on its own within 20 minutes.\n"
  );
  return 0;
}

// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.command === "help") {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  if (opts.command === "replay") {
    if (!opts.traceFile) throw new Error("replay needs a trace file");
    const summary = replay(path.resolve(opts.traceFile), opts);
    printSummary(summary);
    return exitCode(summary);
  }
  if (opts.command === "cleanup") return cleanup(opts);
  if (opts.command !== "run") throw new Error(`unknown command ${opts.command}`);

  const scenarios = selectScenarios(opts.scenarios);
  if (!scenarios.length) throw new Error(`no scenarios matched ${opts.scenarios}`);

  opts.runId = new Date().toISOString().replace(/[:.]/g, "-");
  // The collector is opened first and only then handed the run, so nothing can
  // be collected before there is somewhere to put it.
  let run = null;
  const channel = await openChannel({
    browser: opts.browser,
    port: opts.port,
    runId: opts.runId,
    onRecord: (rec) => run && run.collect(rec),
  });
  run = new Run(opts, channel);

  const problems = await run.preflight();
  if (problems.length) {
    for (const p of problems) process.stderr.write(`preflight: ${p}\n`);
    await channel.close();
    run.close();
    return 3;
  }
  process.stdout.write(`extension seam: live (collector ${channel.endpoint})\n`);

  let summary;
  try {
    const results = await run.execute(scenarios);
    summary = summarize({ repoRoot: REPO_ROOT, opts, runId: run.runId, results, seamLive: true });
  } finally {
    await run.tearDownRemaining().catch(() => {});
    for (const rec of run.drainHostLog()) run.records.push({ ...rec, runId: run.runId });
    await channel.close();
    run.close();
  }

  const files = writeArtifacts(opts.out, run.runId, run.records, summary);
  printSummary(summary);
  process.stdout.write(`\n  trace:   ${files.trace}\n  verdict: ${files.verdict}\n`);
  return exitCode(summary);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`focus-loop: ${err && err.message ? err.message : err}\n`);
    process.exit(3);
  }
);
