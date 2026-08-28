#!/usr/bin/env node
/**
 * Issue #33 live Helium diagnostic.
 *
 * Snapshots Helium windows/tabs via AppleScript (read-only) and, when a
 * service-worker probe dump is supplied, records every identity named by
 * the issue. One human action: click the napping lil to wake it.
 *
 * Usage:
 *   node .mayosdd/tickets/evidence/issue-33-nap-wake-regression/live-wake-trace.mjs snapshot > before.json
 *   node .mayosdd/tickets/evidence/issue-33-nap-wake-regression/live-wake-trace.mjs snapshot > after.json
 *   node .mayosdd/tickets/evidence/issue-33-nap-wake-regression/live-wake-trace.mjs compare before.json after.json
 *   node .mayosdd/tickets/evidence/issue-33-nap-wake-regression/live-wake-trace.mjs hitl
 *
 * Optional SW dump (paste sw-probe.js in the worker console, then dump):
 *   ... compare before.json after.json --probe probe.json
 *
 * Writes machine-readable JSON to stdout. Does not reload the extension,
 * click wake, or change Helium tabs.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as stdinStream, stdout as stdoutStream } from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAP_PAGE = /chrome-extension:\/\/oofeehjoocddelicpmnpbafmbalaakge\/sleep\.html/;
const FS = "\u001f";

const SNAPSHOT_SCRIPT = `
set fs to ASCII character 31
set out to ""
tell application "Helium"
  repeat with w in windows
    set wid to (id of w) as text
    set widx to (index of w) as text
    set wname to (name of w) as text
    set wmode to "unknown"
    try
      set wmode to (mode of w) as text
    end try
    set out to out & "W" & fs & wid & fs & widx & fs & wmode & fs & wname & linefeed
    try
      repeat with t in tabs of w
        set turl to (URL of t) as text
        set tname to (name of t) as text
        set out to out & "T" & fs & wid & fs & turl & fs & tname & linefeed
      end repeat
    end try
  end repeat
end tell
return out
`;

function snapshotHelium() {
  const raw = execFileSync("osascript", ["-e", SNAPSHOT_SCRIPT], {
    encoding: "utf8",
    timeout: 20000,
  });
  const windows = new Map();
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split(FS);
    if (parts[0] === "W") {
      const [, id, index, mode, name] = parts;
      windows.set(id, { id, index: Number(index), mode, name, tabs: [] });
    } else if (parts[0] === "T") {
      const [, windowId, url, title] = parts;
      const win = windows.get(windowId);
      if (win) win.tabs.push({ url, title });
    }
  }
  const list = [...windows.values()].sort((a, b) => a.index - b.index);
  return {
    capturedAt: new Date().toISOString(),
    source: "osascript Helium",
    windows: list,
  };
}

function parseNap(url) {
  if (!NAP_PAGE.test(url || "")) return null;
  try {
    const u = new URL(url);
    return {
      captureKey: u.searchParams.get("k"),
      originalUrl: u.searchParams.get("u"),
      originalTitle: u.searchParams.get("t"),
    };
  } catch {
    return { captureKey: null, originalUrl: null, originalTitle: null };
  }
}

function nappingLils(snap) {
  const found = [];
  for (const win of snap.windows || []) {
    for (const tab of win.tabs || []) {
      const nap = parseNap(tab.url);
      if (nap) found.push({ windowId: win.id, mode: win.mode, title: win.name, tab, nap });
    }
  }
  return found;
}

function findUrl(snap, url) {
  const hits = [];
  for (const win of snap.windows || []) {
    for (const [i, tab] of (win.tabs || []).entries()) {
      if (tab.url === url) hits.push({ windowId: win.id, mode: win.mode, index: win.index, title: win.name, tabIndex: i, tab });
    }
  }
  return hits;
}

function compare(before, after, probe) {
  const naps = nappingLils(before);
  const nap = naps[0] || null;
  const originalUrl = nap && nap.nap.originalUrl;
  const beforeIds = new Set((before.windows || []).map((w) => w.id));
  const afterIds = new Set((after.windows || []).map((w) => w.id));
  const removedWindowIds = [...beforeIds].filter((id) => !afterIds.has(id));
  const lilWindowRemoved = !!(nap && !afterIds.has(nap.windowId));
  const afterOriginal = originalUrl ? findUrl(after, originalUrl) : [];
  const beforeOriginal = originalUrl ? findUrl(before, originalUrl) : [];
  const beforePrimaryCounts = new Map(
    (before.windows || []).map((w) => [w.id, (w.tabs || []).filter((t) => t.url === originalUrl).length])
  );
  const gainedInOtherWindow = afterOriginal.filter((hit) => {
    if (!nap) return false;
    if (hit.windowId === nap.windowId) return false;
    const prior = beforePrimaryCounts.get(hit.windowId) || 0;
    const now = afterOriginal.filter((h) => h.windowId === hit.windowId).length;
    return now > prior;
  });
  const destination = gainedInOtherWindow.length
    ? [...gainedInOtherWindow].sort((a, b) => b.tabIndex - a.tabIndex)[0]
    : null;
  const front = (after.windows || []).find((w) => w.index === 1) || null;

  const createEvent =
    probe &&
    Array.isArray(probe.events) &&
    probe.events.find((e) => e.op === "tabs.create");
  const removeEvents =
    (probe && Array.isArray(probe.events) && probe.events.filter((e) => e.op === "tabs.remove")) || [];
  const windowRemovedEvents =
    (probe && Array.isArray(probe.events) && probe.events.filter((e) => e.op === "windows.onRemoved")) || [];

  const requested =
    (createEvent && createEvent.requestedWindowId != null && {
      value: String(createEvent.requestedWindowId),
      source: "sw-probe tabs.create",
    }) ||
    (nap && { value: String(nap.windowId), source: "nap-page window (sender)" });

  const returned =
    (createEvent && createEvent.returnedWindowId != null && {
      value: String(createEvent.returnedWindowId),
      source: "sw-probe tabs.create return",
    }) ||
    (destination && {
      value: String(destination.windowId),
      source: "inferred from new original-URL tab after wake",
    }) ||
    { value: null, source: "unobserved" };

  const napTabRemoved = lilWindowRemoved || removeEvents.length > 0;
  const registry =
    probe && probe.registry != null
      ? probe.registry
      : nap
        ? { source: "unobserved", sleepCaptureKeyFromUrl: nap.nap.captureKey }
        : null;

  const stillNapping = nappingLils(after);
  const stillOwnsUrl =
    originalUrl &&
    afterOriginal.some((hit) => hit.windowId === (nap && nap.windowId));

  let verdict = "incomplete";
  let symptom = "not enough observations";
  if (nap && lilWindowRemoved && gainedInOtherWindow.length) {
    verdict = "fail";
    symptom = "wake closed the lil and created the original URL as a tab in another window";
  } else if (nap && !lilWindowRemoved && stillOwnsUrl && gainedInOtherWindow.length === 0 && stillNapping.length === 0) {
    verdict = "pass";
    symptom = "wake kept the lil and the original URL did not appear in another window";
  } else if (nap && !lilWindowRemoved && stillNapping.length) {
    verdict = "incomplete";
    symptom = "lil still napping — wake may not have run";
  }

  return {
    capturedAt: new Date().toISOString(),
    issue: 33,
    identities: {
      napSenderWindowId: nap ? nap.windowId : null,
      requestedPreloadWindowId: requested,
      returnedFreshTabWindowId: returned,
      napTabRemoval: {
        observed: napTabRemoved,
        swRemoveEvents: removeEvents,
        lilWindowGone: lilWindowRemoved,
      },
      lilWindowRemoval: {
        observed: lilWindowRemoved,
        removedWindowIds,
        swWindowRemovedEvents: windowRemovedEvents,
      },
      registry,
      finalDestination: destination || (stillOwnsUrl && nap && { windowId: nap.windowId, mode: (after.windows || []).find((w) => w.id === nap.windowId)?.mode }) || null,
      finalFocus: front && { windowId: front.id, index: front.index, mode: front.mode, name: front.name },
    },
    counts: {
      nappingLilsBefore: naps.length,
      nappingLilsAfter: stillNapping.length,
      originalUrlTabsBefore: beforeOriginal.length,
      originalUrlTabsAfter: afterOriginal.length,
      heliumWindowsBefore: (before.windows || []).length,
      heliumWindowsAfter: (after.windows || []).length,
    },
    verdict,
    symptom,
    probe: probe || null,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function usage() {
  return `Usage:
  node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} snapshot
  node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} compare <before.json> <after.json> [--probe probe.json]
  node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} hitl [--out LIVE-TRACE.json] [--probe probe.json]

hitl: snapshot → wait for one wake click → snapshot → compare → write JSON.
`;
}

async function hitl(outPath, probePath) {
  if (!stdinStream.isTTY) {
    throw new Error("hitl requires a TTY; use snapshot + compare instead");
  }
  const before = snapshotHelium();
  const naps = nappingLils(before);
  if (!naps.length) {
    const result = {
      capturedAt: new Date().toISOString(),
      verdict: "incomplete",
      symptom: "no napping lil in Helium at start",
    };
    if (outPath) fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  const rl = readline.createInterface({ input: stdinStream, output: stdoutStream });
  process.stderr.write(
    `Napping lil window ${naps[0].windowId} (${naps[0].title}).\nClick the napping lil to wake it, then press Enter.\n`
  );
  await rl.question("");
  rl.close();
  const after = snapshotHelium();
  const probe = probePath ? readJson(probePath) : null;
  const result = compare(before, after, probe);
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  return result;
}

const args = process.argv.slice(2);
const cmd = args[0];

try {
  if (cmd === "snapshot" || cmd === undefined) {
    process.stdout.write(JSON.stringify(snapshotHelium(), null, 2) + "\n");
  } else if (cmd === "compare") {
    const beforeFile = args[1];
    const afterFile = args[2];
    if (!beforeFile || !afterFile) {
      process.stderr.write(usage());
      process.exit(2);
    }
    const probeIdx = args.indexOf("--probe");
    const probe = probeIdx >= 0 ? readJson(args[probeIdx + 1]) : null;
    const result = compare(readJson(beforeFile), readJson(afterFile), probe);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(result.verdict === "fail" ? 1 : result.verdict === "pass" ? 0 : 2);
  } else if (cmd === "hitl") {
    const outIdx = args.indexOf("--out");
    const probeIdx = args.indexOf("--probe");
    const outPath = outIdx >= 0 ? args[outIdx + 1] : path.join(HERE, "LIVE-TRACE.json");
    const probePath = probeIdx >= 0 ? args[probeIdx + 1] : null;
    const result = await hitl(outPath, probePath);
    process.stdout.write(JSON.stringify({ verdict: result.verdict, symptom: result.symptom, outPath }, null, 2) + "\n");
    process.exit(result.verdict === "fail" ? 1 : result.verdict === "pass" ? 0 : 2);
  } else {
    process.stderr.write(usage());
    process.exit(2);
  }
} catch (err) {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exit(3);
}
