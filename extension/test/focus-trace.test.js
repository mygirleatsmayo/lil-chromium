// LILFOCUS seam (issue #30). The real-Mac loop's verdict is only as good as
// what the extension reports, so these tests pin the two things that can
// silently break it: the seam stays inert until armed, and once armed it
// records the exact focus boundaries the loop reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { boot } from "./harness.js";
import { fixture } from "./fixture.js";

// The seam derives this from the arm's port and run id; nothing may redirect it.
const ENDPOINT = "http://127.0.0.1:8931/t/run-1";

function arm(extra = {}) {
  return { type: "lil-focus-trace", op: "arm", runId: "run-1", port: 8931, ...extra };
}

function events(env, name) {
  return env.traced().filter((e) => e.event === name);
}

// The fake browser starts with no windows; several scenarios need the ordinary
// Helium window ("Primary") that a lil is opened alongside.
async function openPrimaryWindow(env) {
  return env.chrome.windows.create({ url: "https://primary.example/", type: "normal", focused: true });
}

/** Open one lil and return it — the newest popup, never an earlier one. */
async function openLil(env, extra = {}) {
  await env.deliver({ type: "open", url: "https://example.com/docs", left: 10, top: 10, ...extra });
  return env.windows().filter((w) => w.type === "popup").pop();
}

test("the seam records nothing until it is armed", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await openLil(env);
  await env.chrome.windows.remove(env.windows().find((w) => w.type === "popup").id);

  assert.deepEqual(env.posts(), []);
});

test("arming is confirmed and disarming stops the stream", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(arm());

  assert.equal(events(env, "trace-armed").length, 1);
  const armedAt = env.traced().length;

  await env.deliver({ type: "lil-focus-trace", op: "disarm" });
  await openLil(env);

  // The disarm notice itself is the last record; the open that followed is not.
  assert.equal(env.traced()[armedAt].event, "trace-disarmed");
  assert.equal(events(env, "open-request").length, 0);
});

test("an armed run posts tagged, ordered records to the collector", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(arm());
  await openLil(env);

  const records = env.traced();
  assert.ok(records.every((r) => r.tag === "LILFOCUS" && r.runId === "run-1" && r.source === "extension"));
  assert.deepEqual(
    records.map((r) => r.seq),
    records.map((_, i) => i)
  );
  assert.ok(env.posts().every((p) => p.url === ENDPOINT && p.init.method === "POST"));
});

test("an expired arm stops tracing without being disarmed", async () => {
  const env = await boot({ clock: true });
  await env.deliver(fixture("message-context"));
  await env.deliver(arm({ ttlMs: 60_000 }));
  const armedCount = env.traced().length;

  await env.clock.advance(60_001);
  await openLil(env);

  assert.equal(env.traced().length, armedCount);
});

test("an open records the app-supplied context and the one the extension chose", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(arm());
  await env.blurBrowser(); // no Chromium window focused: the app's candidate is eligible
  await openLil(env, { priorContext: { kind: "external-app", pid: 4242, bundleId: "com.apple.mail" } });

  const [request] = events(env, "open-request");
  assert.deepEqual(request.detail.appSuppliedPriorContext, {
    kind: "external-app",
    pid: 4242,
    bundleId: "com.apple.mail",
  });

  const [capture] = events(env, "prior-context-capture");
  assert.equal(capture.detail.windows.some((w) => w.focused), false);

  const [begin] = events(env, "lil-create-begin");
  assert.equal(begin.detail.chosenBy, "live-focus-capture");
  assert.deepEqual(begin.detail.chosenPriorContext, {
    kind: "external-app",
    pid: 4242,
    bundleId: "com.apple.mail",
  });
});

test("a focused Chromium window overriding the app's candidate is visible in the trace", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(arm());
  const normal = await openPrimaryWindow(env);
  await openLil(env, { priorContext: { kind: "external-app", pid: 4242, bundleId: "com.apple.mail" } });

  const [capture] = events(env, "prior-context-capture");
  assert.equal(
    capture.detail.windows.find((w) => w.focused).id,
    normal.id,
    "the sibling Chromium window Chromium reported as focused"
  );
  const [begin] = events(env, "lil-create-begin");
  assert.deepEqual(begin.detail.chosenPriorContext, { kind: "normal-window", windowId: normal.id });
});

test("closing a focused lil records what it restored and why", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(arm());
  const normal = await openPrimaryWindow(env);
  const lil = await openLil(env);

  await env.chrome.windows.remove(lil.id);

  const [removed] = events(env, "window-removed");
  assert.equal(removed.detail.windowId, lil.id);
  assert.equal(removed.detail.wasLil, true);
  assert.equal(removed.detail.wasFocused, true);
  assert.deepEqual(removed.detail.priorContext, { kind: "normal-window", windowId: normal.id });

  const [restore] = events(env, "restore-attempt");
  assert.equal(restore.detail.outcome, "focus-window");
  assert.deepEqual(restore.detail.priorContext, { kind: "normal-window", windowId: normal.id });
});

// Live trace 2026-09-17: Chromium hands key to a sibling window ~30 ms after
// the closing lil's tab goes and before the window itself is reported gone.
// A restoration that waits for window-removed lands after that handoff.
test("a focused lil restores its prior context once, before Chromium hands key to a sibling", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(arm());
  const normal = await openPrimaryWindow(env);
  const lil = await openLil(env);
  // Chromium reports each tab's removal as a window close; a wake swap can
  // leave a lil with two.
  await env.chrome.tabs.create({ windowId: lil.id, url: "https://example.com/second" });

  await env.chrome.windows.remove(lil.id);

  const restores = events(env, "restore-attempt");
  const [removed] = events(env, "window-removed");
  assert.equal(restores.length, 1, "restored exactly once across the teardown");
  assert.equal(restores[0].detail.at, "tab-removed");
  assert.ok(restores[0].seq < removed.seq, "restored before the window was reported gone");
  assert.equal(env.windows().find((w) => w.focused).id, normal.id);
});

test("closing an unfocused lil records that no restoration was attempted", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(arm());
  const lil = await openLil(env);
  await env.blurBrowser(); // the user moved to another app without refocusing

  await env.chrome.windows.remove(lil.id);

  const [removed] = events(env, "window-removed");
  assert.equal(removed.detail.wasFocused, false);
  assert.equal(events(env, "restore-attempt").length, 0);
});

test("an external restoration records whether the host actually received it", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(arm());
  await env.blurBrowser();
  const lil = await openLil(env, { priorContext: { kind: "external-app", pid: 4242, bundleId: "com.apple.mail" } });

  await env.chrome.windows.remove(lil.id);

  const [restore] = events(env, "restore-attempt");
  assert.equal(restore.detail.outcome, "sent-to-host");
  assert.ok(env.outgoing().some((m) => m.type === "restore-focus" && m.priorContext.pid === 4242));
});

test("an on-demand snapshot names every window's identity, type, and focus state", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(arm());
  const normal = await openPrimaryWindow(env);
  const lil = await openLil(env);

  await env.deliver({ type: "lil-focus-trace", op: "snapshot", label: "afterOpen" });

  const [snapshot] = events(env, "windows");
  assert.equal(snapshot.detail.label, "afterOpen");
  const byId = new Map(snapshot.detail.windows.map((w) => [w.id, w]));
  assert.deepEqual(
    { type: byId.get(lil.id).type, isLil: byId.get(lil.id).isLil, focused: byId.get(lil.id).focused },
    { type: "popup", isLil: true, focused: true }
  );
  assert.deepEqual(
    { type: byId.get(normal.id).type, isLil: byId.get(normal.id).isLil, focused: byId.get(normal.id).focused },
    { type: "normal", isLil: false, focused: false }
  );
});

test("an unreachable collector leaves the traced path working", async () => {
  const env = await boot({ fetchFails: true });
  await env.deliver(fixture("message-context"));
  await env.deliver(arm());
  const lil = await openLil(env);
  await env.chrome.windows.remove(lil.id);

  assert.equal(env.windows().some((w) => w.id === lil.id), false, "the lil still opened and closed");
  assert.ok(env.posts().length > 0, "posts were attempted");
});

test("teardown closes only a lil this armed run opened", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const uninvited = await openLil(env); // opened before the run existed

  await env.deliver(arm());
  const ours = await openLil(env);

  // Not this run's lil: inert, and said so.
  await env.deliver({ type: "lil-focus-trace", op: "close-lil", runId: "run-1", windowId: uninvited.id });
  assert.ok(env.windows().some((w) => w.id === uninvited.id));
  assert.equal(events(env, "harness-close")[0].detail.outcome, "not-owned-by-this-run");

  await env.deliver({ type: "lil-focus-trace", op: "close-lil", runId: "run-1", windowId: ours.id });
  assert.equal(env.windows().some((w) => w.id === ours.id), false);
  assert.deepEqual(events(env, "harness-close")[1].detail, { windowId: ours.id, outcome: "closed" });
});

test("teardown can never close Primary, a stale id, or the same lil twice", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(arm());
  const primary = await openPrimaryWindow(env);
  const lil = await openLil(env);
  const gone = await openLil(env);

  const close = (windowId) => env.deliver({ type: "lil-focus-trace", op: "close-lil", runId: "run-1", windowId });

  await close(primary.id);
  assert.ok(env.windows().some((w) => w.id === primary.id), "the ordinary browsing window survives");

  await close(999_999); // never existed
  await close(lil.id);
  await close(lil.id); // already torn down: no longer this run's to close

  // A lil the run opened but the operator closed first is not closed again.
  await env.chrome.windows.remove(gone.id);
  await close(gone.id);
  await close(gone.id); // forgotten after the terminal not-lil outcome

  assert.deepEqual(
    events(env, "harness-close").map((e) => e.detail.outcome),
    [
      "not-owned-by-this-run",
      "not-owned-by-this-run",
      "closed",
      "not-owned-by-this-run",
      "no-longer-a-registered-lil",
      "not-owned-by-this-run",
    ]
  );
});

test("a failed close keeps ownership so the same run can retry, without loosening refusals", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(arm());
  const primary = await openPrimaryWindow(env);
  const lil = await openLil(env);

  const remove = env.chrome.windows.remove.bind(env.chrome.windows);
  let failNext = true;
  env.chrome.windows.remove = async (id) => {
    if (failNext) {
      failNext = false;
      throw new Error("windows.remove failed");
    }
    return remove(id);
  };

  const close = (windowId) => env.deliver({ type: "lil-focus-trace", op: "close-lil", runId: "run-1", windowId });

  await close(lil.id);
  assert.ok(env.windows().some((w) => w.id === lil.id), "the lil is still open after a failed close");
  assert.equal(events(env, "harness-close").at(-1).detail.outcome, "close-failed");

  await close(primary.id);
  assert.ok(env.windows().some((w) => w.id === primary.id), "Primary stays closed-inert while ownership is retained");

  await close(lil.id);
  assert.equal(env.windows().some((w) => w.id === lil.id), false, "the sweep's retry closes the same lil");
  assert.equal(events(env, "harness-close").at(-1).detail.outcome, "closed");

  await close(lil.id);
  await close(999_999);

  assert.deepEqual(
    events(env, "harness-close").map((e) => e.detail.outcome),
    ["close-failed", "not-owned-by-this-run", "closed", "not-owned-by-this-run", "not-owned-by-this-run"]
  );
});

test("teardown is inert while disarmed and for another run's id", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(arm());
  const lil = await openLil(env);

  await env.deliver({ type: "lil-focus-trace", op: "close-lil", runId: "run-2", windowId: lil.id });
  assert.ok(env.windows().some((w) => w.id === lil.id), "another run may not tear this one down");

  await env.deliver({ type: "lil-focus-trace", op: "disarm" });
  await env.deliver({ type: "lil-focus-trace", op: "close-lil", runId: "run-1", windowId: lil.id });
  assert.ok(env.windows().some((w) => w.id === lil.id), "a disarmed seam closes nothing");
});

test("the collector is a loopback endpoint scoped to the run, and cannot be redirected", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(arm({ endpoint: "https://exfil.example/collect", port: 8931 }));
  await openLil(env);

  assert.ok(env.posts().length > 0);
  assert.ok(env.posts().every((p) => p.url === ENDPOINT), "every post goes to the derived run-scoped endpoint");
});

test("an arm the seam cannot trust leaves it disarmed", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));

  for (const bad of [
    { port: 0 },
    { port: 70_000 },
    { port: "8931" },
    { runId: "../../etc" },
    { runId: "" },
    { op: "unheard-of" },
  ]) {
    await env.deliver(arm(bad));
  }
  await openLil(env);

  assert.deepEqual(env.posts(), []);
});
