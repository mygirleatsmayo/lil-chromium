// LILFOCUS seam (issue #30). The real-Mac loop's verdict is only as good as
// what the extension reports, so these tests pin the two things that can
// silently break it: the seam stays inert until armed, and once armed it
// records the exact focus boundaries the loop reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { boot } from "./harness.js";
import { fixture } from "./fixture.js";

const ENDPOINT = "http://127.0.0.1:8931/t";

function arm(extra = {}) {
  return { type: "lil-focus-trace", runId: "run-1", endpoint: ENDPOINT, ...extra };
}

function events(env, name) {
  return env.traced().filter((e) => e.event === name);
}

// The fake browser starts with no windows; several scenarios need the ordinary
// Helium window ("Primary") that a lil is opened alongside.
async function openPrimaryWindow(env) {
  return env.chrome.windows.create({ url: "https://primary.example/", type: "normal", focused: true });
}

async function openLil(env, extra = {}) {
  await env.deliver({ type: "open", url: "https://example.com/docs", left: 10, top: 10, ...extra });
  return env.windows().find((w) => w.type === "popup");
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

  await env.deliver({ type: "lil-focus-trace", enabled: false });
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

  await env.deliver({ type: "lil-focus-trace", snapshot: "afterOpen" });

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

test("teardown closes only the window the harness names, and only while armed", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const uninvited = await openLil(env);

  // Disarmed: the request is ignored outright.
  await env.deliver({ type: "lil-focus-trace", closeWindow: uninvited.id });
  assert.ok(env.windows().some((w) => w.id === uninvited.id));

  await env.deliver(arm());
  await env.deliver({ type: "lil-focus-trace", closeWindow: uninvited.id });

  assert.equal(env.windows().some((w) => w.id === uninvited.id), false);
  assert.equal(events(env, "harness-close")[0].detail.windowId, uninvited.id);
});
