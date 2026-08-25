#!/usr/bin/env node
// LILFOCUS — the real-Mac focus loop for issue #30.
//
//   node scripts/focus-loop.mjs run              # score the whole #30 matrix
//   node scripts/focus-loop.mjs replay <trace>   # re-score a recorded run
//   node scripts/focus-loop.mjs cleanup          # disarm + prove nothing is armed
//
// One command owns capture, bounded repetition, and the pass/fail calculation.
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
// red close control.
//
// See .mayosdd/tickets/evidence/issue-30-real-mac-focus-loop/README.md.

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { needsOperator, selectScenarios } from "./focus-loop/scenarios.mjs";
import { replay, scoreRepetition } from "./focus-loop/replay.mjs";
import { matchProbeWindow, scenarioVerdict } from "./focus-loop/verdict.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const STATE_DIR = path.join(os.homedir(), ".lilchromium");
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
};

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
  --out <dir>          artifact directory

Exit status: 0 = every scenario green, 1 = at least one reproduced (red),
2 = a scenario could not be scored, 3 = preflight failed.`;

// ---------------------------------------------------------------------------
// Native probe
// ---------------------------------------------------------------------------

function probeBinary() {
  const candidates = ["release", "debug"].map((c) => path.join(REPO_ROOT, "mac/.build", c, "lil-focus-probe"));
  const existing = candidates.find((p) => fs.existsSync(p));
  if (existing) return existing;
  process.stderr.write("building lil-focus-probe (first run only)…\n");
  execFileSync("swift", ["build", "-c", "release", "--product", "lil-focus-probe"], {
    cwd: path.join(REPO_ROOT, "mac"),
    stdio: "inherit",
  });
  return candidates[0];
}

async function probe(binary, label) {
  const { stdout } = await execFileAsync(binary, [label]);
  return JSON.parse(stdout);
}

// ---------------------------------------------------------------------------
// Relay socket — the control channel to the extension.
//
// The host forwards any socket line it does not recognise to the extension
// verbatim (see mac/Sources/lilchromium-host/main.swift), so arming needs no
// change to the message contract in docs/PROTOCOL.md.
// ---------------------------------------------------------------------------

function socketPath(browser) {
  return path.join(STATE_DIR, `relay-${browser}.sock`);
}

function sendToRelay(browser, message) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath(browser));
    socket.on("error", reject);
    socket.on("connect", () => socket.end(JSON.stringify(message) + "\n", () => resolve()));
  });
}

const control = {
  arm: (o, runId) =>
    sendToRelay(o.browser, {
      type: "lil-focus-trace",
      runId,
      endpoint: `http://127.0.0.1:${o.port}/t`,
      ttlMs: 20 * 60 * 1000,
    }),
  disarm: (o) => sendToRelay(o.browser, { type: "lil-focus-trace", enabled: false }),
  snapshot: (o, label) => sendToRelay(o.browser, { type: "lil-focus-trace", snapshot: label }),
  closeWindow: (o, windowId) => sendToRelay(o.browser, { type: "lil-focus-trace", closeWindow: windowId }),
};

// ---------------------------------------------------------------------------
// Collector — where the extension's records land.
// ---------------------------------------------------------------------------

function startCollector(port, onRecord) {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        onRecord(JSON.parse(body));
      } catch (_) {
        // A malformed record must not take the collector down mid-run.
      }
      res.writeHead(204, { "Access-Control-Allow-Origin": "*" }).end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// Host log — the native half of the trace.
// ---------------------------------------------------------------------------

function hostLogPath(browser) {
  return path.join(STATE_DIR, `host-${browser}.log`);
}

function hostLogSize(browser) {
  try {
    return fs.statSync(hostLogPath(browser)).size;
  } catch (_) {
    return 0;
  }
}

/** New `[LILFOCUS]` lines since `offset`, as trace records. Returns the new offset. */
function readHostLog(browser, offset) {
  const file = hostLogPath(browser);
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch (_) {
    return { records: [], offset };
  }
  // The host truncates its log at 1MB; restart from the top if it shrank.
  const from = size < offset ? 0 : offset;
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(size - from);
  fs.readSync(fd, buffer, 0, buffer.length, from);
  fs.closeSync(fd);

  const records = buffer
    .toString("utf8")
    .split("\n")
    .filter((line) => line.includes(`[${TAG}]`))
    .map((line) => ({ tag: TAG, source: "host", t: Date.now(), event: "host-log", detail: { line } }));
  return { records, offset: size };
}

// ---------------------------------------------------------------------------
// Arrangement checking — turns "put the windows like this" into a decision.
// ---------------------------------------------------------------------------

/** The display index of the frontmost window belonging to `bundleId`. */
function displayOfApp(snapshot, bundleId) {
  const win = snapshot.windows.find((w) => w.bundleId === bundleId);
  return win ? win.display : null;
}

/**
 * Locate Helium's Primary window and its lils on real displays, by pairing the
 * extension's window list with the native reading.
 */
function browserLayout(snapshot, extensionWindows, bundleId, baseline = null) {
  const browserWindows = snapshot.windows.filter((w) => w.bundleId === bundleId);
  const place = (win) => {
    const match = matchProbeWindow(browserWindows, win.bounds);
    return match ? match.display : null;
  };
  // Without the seam the native reading can still name the layout, by identity
  // rather than by guesswork: every browser window the run itself opened is a
  // lil, so whatever was already there at baseline is the ordinary browsing
  // window — provided there was exactly one. With any other baseline the
  // arrangement reads as unknown and the scenario is reported unscored, rather
  // than scored against a label that might be wrong.
  if (!extensionWindows) {
    const known = baseline || new Set();
    const ordinary = browserWindows.filter((w) => known.has(w.number));
    return ordinary.length === 1
      ? {
          primaryDisplay: ordinary[0].display,
          lilDisplays: browserWindows.filter((w) => !known.has(w.number)).map((w) => w.display),
          layoutFrom: "native",
        }
      : { primaryDisplay: null, lilDisplays: [], layoutFrom: "unknown" };
  }

  const primary = extensionWindows.find((w) => w.type === "normal" && !w.isLil);
  const lils = extensionWindows.filter((w) => w.isLil);
  return {
    primaryDisplay: primary ? place(primary) : null,
    lilDisplays: lils.map(place).filter((d) => d !== null),
    layoutFrom: "extension",
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function preflight(opts) {
  const problems = [];
  if (!fs.existsSync(socketPath(opts.browser))) {
    problems.push(`no relay socket at ${socketPath(opts.browser)} — is ${opts.browser} running with the extension loaded?`);
  }
  if (process.platform !== "darwin") problems.push("this loop only means anything on macOS");
  return problems;
}

async function activateApp(bundleId) {
  await execFileAsync("/usr/bin/open", ["-b", bundleId]);
}

/** Open a lil exactly the way a link click does: hand the URL to the default browser. */
async function openLilThroughProduct(url) {
  await execFileAsync("/usr/bin/open", ["-g", url]);
}

class Run {
  constructor(opts) {
    this.opts = opts;
    this.runId = `${new Date().toISOString().replace(/[:.]/g, "-")}`;
    this.records = [];
    this.hostOffset = hostLogSize(opts.browser);
    this.rl = process.stdin.isTTY
      ? readline.createInterface({ input: process.stdin, output: process.stdout })
      : null;
  }

  record(event, detail, source = "harness") {
    const rec = { tag: TAG, runId: this.runId, source, t: Date.now(), event, detail };
    this.records.push(rec);
    return rec;
  }

  collect(rec) {
    this.records.push(rec);
  }

  drainHostLog() {
    const { records, offset } = readHostLog(this.opts.browser, this.hostOffset);
    this.hostOffset = offset;
    for (const rec of records) this.records.push({ ...rec, runId: this.runId });
  }

  /** The extension's window list, requested on demand and awaited by label. */
  async extensionWindows(label) {
    const before = this.records.length;
    await control.snapshot(this.opts, label);
    for (let i = 0; i < 40; i++) {
      await sleep(50);
      const hit = this.records
        .slice(before)
        .find((r) => r.source === "extension" && r.event === "windows" && r.detail && r.detail.label === label);
      if (hit) return hit.detail.windows;
    }
    return null;
  }

  /**
   * Does the browser actually carry the LILFOCUS seam? A browser running a
   * build without extension/focus-trace.js answers nothing, and the loop must
   * say so rather than silently reporting a thinner trace as a full one. The
   * native reading still decides every verdict either way.
   */
  async detectSeam() {
    await control.arm(this.opts, this.runId);
    for (let i = 0; i < 20; i++) {
      await sleep(75);
      if (this.records.some((r) => r.source === "extension")) return true;
    }
    return false;
  }

  async ask(prompt) {
    if (!this.rl) throw new Error("this scenario needs an operator, but stdin is not a terminal");
    process.stdout.write("\n");
    await this.rl.question(`  >>> ${prompt}\n      [Enter when done] `);
  }

  async runStep(step, probes) {
    if (step.do === "activate") {
      await activateApp(step.app === "switch" ? this.opts.switchApp : this.opts.sourceApp);
    } else if (step.do === "open") {
      await openLilThroughProduct(this.opts.url);
    } else if (step.do === "ask") {
      await this.ask(step.prompt);
    }
    await sleep(this.opts.settleMs);
    const snapshot = await probe(this.probeBinary, step.probe);
    this.records.push({ ...snapshot, runId: this.runId, step: step.do });
    probes[step.probe] = snapshot;
    this.drainHostLog();
  }

  /** One repetition: arm, walk the steps, score, tidy up after ourselves. */
  async runRepetition(scenario, index) {
    const probes = {};
    this.record("repetition-begin", { scenario: scenario.id, repetition: index + 1 });
    await control.arm(this.opts, this.runId);
    await sleep(150);

    const createdBefore = this.records.length;
    for (const step of scenario.steps) await this.runStep(step, probes);

    const created = this.records
      .slice(createdBefore)
      .filter((r) => r.source === "extension" && r.event === "lil-created")
      .map((r) => r.detail);
    const lastCreated = created[created.length - 1] || null;

    // The live run and a replay score through the same function, so an
    // artifact can never disagree with the run that produced it.
    const result = scoreRepetition({ scenario, probes, created, bundleId: this.opts.bundleId });

    const rep = { repetition: index + 1, ...result, createdWindowId: lastCreated && lastCreated.windowId };
    this.record("repetition-verdict", rep);
    this.report(rep);

    // Teardown, not measurement: an opening repetition leaves a lil behind, and
    // the next repetition must start from the arrangement that was confirmed.
    // Only the seam can close it, so without the seam the caller re-checks the
    // arrangement instead of assuming it survived.
    if (scenario.kind === "open") {
      rep.toreDown = !!(lastCreated && this.seamLive);
      if (rep.toreDown) {
        await control.closeWindow(this.opts, lastCreated.windowId);
        await sleep(this.opts.settleMs);
        this.drainHostLog();
      }
    }
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
      const snapshot = await probe(this.probeBinary, `arrangement:${scenario.id}`);
      const extensionWindows = await this.extensionWindows(`arrangement:${scenario.id}`);
      const layout = browserLayout(snapshot, extensionWindows, this.opts.bundleId, this.baselineBrowserWindows);
      const facts = { ...layout, sourceDisplay: displayOfApp(snapshot, source) };
      const ok = scenario.arrangement.check(facts) && scenario.neighbours.check(facts);
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
    this.probeBinary = probeBinary();
    // Baseline identity: every browser window on screen now predates the run,
    // so anything that appears later is a lil this loop opened.
    const baseline = await probe(this.probeBinary, "baseline");
    this.records.push({ ...baseline, runId: this.runId });
    this.baselineBrowserWindows = new Set(
      baseline.windows.filter((w) => w.bundleId === this.opts.bundleId).map((w) => w.number)
    );
    this.seamLive = await this.detectSeam();
    this.record("seam", {
      live: this.seamLive,
      note: this.seamLive
        ? "extension trace records are being collected"
        : "the running browser has no LILFOCUS seam; verdicts come from the native reading alone",
    });
    process.stdout.write(`extension seam: ${this.seamLive ? "live" : "absent (native-only verdicts)"}\n`);
    const results = [];
    for (const scenario of scenarios) {
      process.stdout.write(`\n=== ${scenario.id}\n`);
      if (needsOperator(scenario) && !this.rl) {
        process.stdout.write("      skipped: needs an operator at the terminal\n");
        results.push({ scenario: scenario.id, verdict: "inconclusive", reason: "no operator", repetitions: [] });
        continue;
      }
      if (scenario.arrangement && !(await this.confirmArrangement(scenario))) {
        results.push({ scenario: scenario.id, verdict: "inconclusive", reason: "arrangement never matched", repetitions: [] });
        continue;
      }
      const reps = [];
      const count = this.opts.reps || scenario.defaultReps;
      for (let i = 0; i < count; i++) {
        const previous = reps[reps.length - 1];
        if (previous && previous.toreDown === false && !(await this.confirmArrangement(scenario))) {
          reps.push({
            repetition: i + 1,
            verdict: "inconclusive",
            reason: "the previous lil is still open, so this scenario's arrangement no longer holds",
          });
          break;
        }
        reps.push(await this.runRepetition(scenario, i));
      }
      results.push({ scenario: scenario.id, kind: scenario.kind, ...scenarioVerdict(reps), repetitions: reps });
    }
    return results;
  }

  close() {
    if (this.rl) this.rl.close();
  }
}

// ---------------------------------------------------------------------------
// Artifacts + summary
// ---------------------------------------------------------------------------

function writeArtifacts(outDir, runId, records, summary) {
  fs.mkdirSync(outDir, { recursive: true });
  const trace = path.join(outDir, `trace-${runId}.jsonl`);
  const verdict = path.join(outDir, `verdict-${runId}.json`);
  fs.writeFileSync(trace, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(verdict, JSON.stringify(summary, null, 2) + "\n");
  return { trace, verdict };
}

function summarize(opts, runId, results, seamLive) {
  const counts = { red: 0, green: 0, inconclusive: 0 };
  for (const r of results) counts[r.verdict]++;
  return {
    tag: TAG,
    issue: 30,
    runId,
    startedAt: new Date().toISOString(),
    environment: environment(opts),
    settings: {
      browser: opts.browser,
      bundleId: opts.bundleId,
      sourceApp: opts.sourceApp,
      switchApp: opts.switchApp,
      url: opts.url,
      settleMs: opts.settleMs,
    },
    counts,
    overall: counts.red ? "red" : counts.inconclusive ? "inconclusive" : "green",
    seamLive,
    scenarios: results,
  };
}

/** Pin what the run actually exercised — versions decided the last QA round. */
function environment(opts) {
  const read = (fn, fallback = null) => {
    try {
      return fn();
    } catch (_) {
      return fallback;
    }
  };
  return {
    platform: `${os.platform()} ${os.release()}`,
    browserVersion: read(() =>
      execFileSync("/usr/bin/defaults", [
        "read",
        `/Applications/${opts.browser === "helium" ? "Helium" : opts.browser}.app/Contents/Info`,
        "CFBundleShortVersionString",
      ]).toString().trim()
    ),
    appVersion: read(() =>
      execFileSync("/usr/bin/defaults", [
        "read",
        "/Applications/LilChromium.app/Contents/Info",
        "CFBundleShortVersionString",
      ]).toString().trim()
    ),
    extensionVersion: read(
      () => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "extension/manifest.json"), "utf8")).version_name
    ),
    worktreeCommit: read(() => execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "--short", "HEAD"]).toString().trim()),
  };
}

function printSummary(summary) {
  process.stdout.write("\n--- LILFOCUS verdict ---\n");
  for (const s of summary.scenarios) {
    const rate = s.repetitions && s.repetitions.length ? ` (${s.reproductions}/${s.repetitions.length})` : "";
    process.stdout.write(`  ${s.verdict.padEnd(12)} ${s.scenario}${rate}\n`);
  }
  process.stdout.write(`  overall: ${summary.overall}\n`);
}

function exitCode(summary) {
  if (summary.overall === "red") return 1;
  if (summary.overall === "inconclusive") return 2;
  return 0;
}

// ---------------------------------------------------------------------------
// Cleanup — the one exact check the ticket asks for.
// ---------------------------------------------------------------------------

async function cleanup(opts) {
  let disarmed = "no relay socket (nothing can be armed)";
  if (fs.existsSync(socketPath(opts.browser))) {
    await sendToRelay(opts.browser, { type: "lil-focus-trace", enabled: false });
    disarmed = `disarm sent to relay-${opts.browser}.sock`;
  }
  process.stdout.write(`${disarmed}\n`);
  process.stdout.write(
    "\nThe seam is retained deliberately (issue #30 allows either). To see all of it:\n" +
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

  const problems = preflight(opts);
  if (problems.length) {
    for (const p of problems) process.stderr.write(`preflight: ${p}\n`);
    return 3;
  }

  const scenarios = selectScenarios(opts.scenarios);
  if (!scenarios.length) throw new Error(`no scenarios matched ${opts.scenarios}`);

  const run = new Run(opts);
  const server = await startCollector(opts.port, (rec) => run.collect(rec));
  let summary;
  try {
    const results = await run.execute(scenarios);
    summary = summarize(opts, run.runId, results, run.seamLive);
  } finally {
    await control.disarm(opts).catch(() => {});
    run.drainHostLog();
    run.close();
    server.close();
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
