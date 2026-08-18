import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, WORKER_PATH } from "./harness.js";
import { fixture } from "./fixture.js";

function sender(win) {
  const tab = win.tabs[0];
  return { tab: { id: tab.id, windowId: win.id, url: tab.url } };
}

function journalHas(env, op, pred = () => true) {
  return env.journal().some((e) => e.op === op && pred(e));
}

test("boots the production service worker, not a copy", async () => {
  const env = await boot();
  assert.equal(path.basename(WORKER_PATH), "background.js");
  assert.equal(fs.realpathSync(env.workerPath), fs.realpathSync(WORKER_PATH));
  assert.equal(path.basename(path.dirname(WORKER_PATH)), "extension");
  const source = fs.readFileSync(WORKER_PATH, "utf8");
  assert.match(source, /lil-chromium background service worker/);
  assert.equal(source.includes("process.env.LIL_HARNESS"), false);
});

test("connects to the native host and asks for context", async () => {
  const env = await boot();
  assert.equal(env.nativeName(), "com.lilchromium.relay");
  const first = env.outgoing().find((m) => m.type === "get-context");
  assert.ok(first, "worker posts get-context on connect");
  assert.equal(typeof first.id, "string");
});

test("context fixture lands as host identity plus config objects, with no bundle ids", async () => {
  const wire = fixture("message-context");
  const env = await boot();
  await env.deliver(wire);

  const { context } = await env.message({ action: "getContext" });
  assert.equal(context.browser, "brave");
  assert.equal(context.browserName, "Brave");
  assert.equal(context.defaultBrowser, "helium");
  assert.equal(context.defaultBrowserName, "Helium");
  assert.notEqual(context.browser, context.defaultBrowser);
  assert.equal(context.fallbackBrowser, "chrome");
  assert.equal(context.linkBehavior, "new-lil");
  assert.equal(context.sleep.afterMinutes, 45);
  assert.equal(context.sleep.formGuard, false);
  assert.equal(context.sleep.tint, "#3311aa");
  assert.deepEqual(context.sleep.whitelist, ["mail.google.com"]);
  assert.equal(context.searchEngine.name, "Kagi");
  assert.equal(context.searchEngine.template, "https://kagi.com/search?q=%s");
  assert.equal(context.hoverBar.style, "solid");
  assert.equal(context.hoverBar.tint, "#112233");
  assert.deepEqual(
    context.knownBrowsers.map((b) => b.slug),
    ["helium", "brave"]
  );
  assert.equal(
    JSON.stringify(context).includes("bundleId"),
    false,
    "context wires never carry bundle ids"
  );
  assert.deepEqual(Object.keys(wire).sort(), [
    "browser",
    "browserName",
    "defaultBrowser",
    "defaultBrowserName",
    "ephemeralDefault",
    "fallbackBrowser",
    "hoverBar",
    "id",
    "knownBrowsers",
    "linkBehavior",
    "searchEngine",
    "sleep",
    "type",
  ]);
});

test("v1 config fixture yields the same additive defaults as the native suite", async () => {
  const cfg = fixture("config-v1-legacy");
  const env = await boot();
  await env.deliver({
    type: "context",
    id: "ctx-legacy",
    defaultBrowser: cfg.defaultBrowser,
    linkBehavior: cfg.linkBehavior,
  });
  const { context } = await env.message({ action: "getContext" });
  assert.equal(context.defaultBrowser, "brave");
  assert.equal(context.linkBehavior, "same-lil");
  assert.equal(context.fallbackBrowser, "chrome");
  assert.equal(context.ephemeralDefault, "never");
  assert.equal(context.sleep.enabled, false);
  assert.equal(context.sleep.afterMinutes, 30);
  assert.equal(context.sleep.audioGuard, true);
  assert.equal(context.sleep.formGuard, true);
  assert.equal(context.sleep.tint, "purple");
  assert.equal(context.sleep.whitelist.length, 0);
  assert.equal(context.searchEngine.name, "Startpage");
  assert.equal(context.searchEngine.template, "https://www.startpage.com/sp/search?query=%s");
  assert.equal(context.hoverBar.style, "glass");
  assert.equal(context.hoverBar.tint, null);
});

test("v2 complete config fixture matches the context wire's config objects", async () => {
  const cfg = fixture("config-v2-complete");
  const wire = fixture("message-context");
  assert.equal(cfg.sleep.afterMinutes, wire.sleep.afterMinutes);
  assert.equal(cfg.searchEngine.name, wire.searchEngine.name);
  assert.equal(cfg.hoverBar.style, wire.hoverBar.style);

  const env = await boot();
  await env.deliver(wire);
  const { context } = await env.message({ action: "getContext" });
  assert.equal(context.sleep.afterMinutes, cfg.sleep.afterMinutes);
  assert.equal(context.searchEngine.template, cfg.searchEngine.template);
  assert.equal(context.hoverBar.tint, cfg.hoverBar.tint);
});

test("legacy open fixture creates a focused popup lil and registers it", async () => {
  const open = fixture("message-open-legacy");
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(open);

  const wins = env.windows();
  assert.equal(wins.length, 1);
  assert.equal(wins[0].type, "popup");
  assert.equal(wins[0].incognito, false);
  assert.equal(wins[0].focused, true);
  assert.equal(wins[0].tabs[0].url, "https://example.com/docs");
  assert.equal(open.incognito, undefined);
  assert.ok(journalHas(env, "windows.create", (e) => e.create.url === open.url));
  assert.ok(journalHas(env, "windows.update", (e) => e.update.focused === true));

  const entry = env.registry()[String(wins[0].id)];
  assert.ok(entry);
  assert.equal(entry.url, open.url);
  assert.equal(entry.expiry, 6);
});

test("tab URL update is recorded on the lil registry", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(fixture("message-open-legacy"));
  const win = env.windows()[0];
  const tab = win.tabs[0];
  await env.chrome.tabs.update(tab.id, { url: "https://example.com/other" });
  await env.flush();
  assert.equal(env.registry()[String(win.id)].url, "https://example.com/other");
  assert.ok(journalHas(env, "tabs.update", (e) => e.update.url === "https://example.com/other"));
});

test("resized lil updates registry bounds", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(fixture("message-open-legacy"));
  const id = env.windows()[0].id;
  await env.chrome.windows.update(id, { left: 40, top: 50, width: 800, height: 600 });
  await env.flush();
  const bounds = env.registry()[String(id)].bounds;
  assert.equal(bounds.left, 40);
  assert.equal(bounds.top, 50);
  assert.equal(bounds.width, 800);
  assert.equal(bounds.height, 600);
});

test("promoting a lil into a host tab moves it and drops the registry entry", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const host = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver(fixture("message-open-legacy"));
  const lil = env.windows().find((w) => w.type === "popup");
  await env.message({ action: "promote", dest: "host-tab" }, sender(lil));

  assert.ok(journalHas(env, "tabs.move", (e) => e.move.windowId === host.id));
  assert.equal(Object.keys(env.registry()).length, 0);
  const hostNow = env.windows().find((w) => w.id === host.id);
  assert.ok(hostNow.tabs.some((t) => t.url === "https://example.com/docs"));
  assert.equal(env.windows().some((w) => w.type === "popup"), false);
});

test("closing a focused lil removes it and focuses the prior window", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver({ type: "open", url: "https://a.example/", left: 10, top: 10 });
  const first = env.windows()[0].id;
  await env.deliver({ type: "open", url: "https://b.example/", left: 20, top: 20 });
  const second = env.windows().find((w) => w.id !== first);
  assert.equal(second.focused, true);

  await env.chrome.windows.remove(second.id);
  await env.flush();

  assert.equal(env.registry()[String(second.id)], undefined);
  assert.ok(env.registry()[String(first)]);
  assert.equal(env.windows().find((w) => w.id === first).focused, true);
  assert.ok(journalHas(env, "windows.update", (e) => e.windowId === first && e.update.focused === true));
});

test("history-query replies with the shared history-result rows, including sparse ones", async () => {
  const expected = fixture("message-history-result");
  const now = Date.now();
  const history = expected.items.map((item) =>
    typeof item.lastVisitTime === "number" ? { ...item, lastVisitTime: now } : item
  );
  const env = await boot({ history });
  await env.deliver({ type: "history-query", id: expected.id, text: "", maxResults: 100 });
  const reply = env.outgoing().filter((m) => m.type === "history-result").at(-1);
  assert.equal(reply.id, "h-1");
  assert.equal(reply.items.length, expected.items.length);
  const sparse = reply.items.find((i) => i.url === "https://docs.swift.org/guide");
  assert.ok(sparse);
  assert.equal(sparse.title, "");
  assert.equal(sparse.visitCount, 0);
  assert.equal(sparse.typedCount, 0);
  assert.equal(sparse.lastVisitTime, 0);
});

test("promote to another browser posts open-external and removes the lil", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(fixture("message-open-legacy"));
  const lil = env.windows()[0];
  await env.message({ action: "promote" }, sender(lil));
  const ext = env.outgoing().find((m) => m.type === "open-external");
  assert.ok(ext);
  assert.equal(ext.browser, "helium");
  assert.equal(ext.url, "https://example.com/docs");
  assert.equal(env.windows().length, 0);
  assert.equal(Object.keys(env.registry()).length, 0);
});

test("Send to lil from a normal window creates a focused popup and registers it", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.installed();
  const normal = await env.chrome.windows.create({ url: "https://mail.example/", type: "normal" });
  await env.clickMenu("send-to-lil", { id: normal.tabs[0].id, windowId: normal.id, url: normal.tabs[0].url });
  const lil = env.windows().find((w) => w.type === "popup");
  assert.ok(lil);
  assert.equal(lil.focused, true);
  assert.equal(lil.tabs[0].url, "https://mail.example/");
  assert.ok(env.registry()[String(lil.id)]);
  assert.ok(env.menus().some((m) => m.id === "send-to-lil"));
});

test("sweep alarm is installed and a tick is harmless with no lils", async () => {
  const env = await boot();
  const alarm = await env.chrome.alarms.get("lil-sweep");
  assert.ok(alarm);
  assert.equal(alarm.periodInMinutes, 1);
  await env.alarm();
  assert.equal(env.windows().length, 0);
});

test("sleeping a lil stores a capture in IndexedDB and navigates to the sleep page", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(fixture("message-open-legacy"));
  const lil = env.windows()[0];
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const tab = env.windows()[0].tabs[0];
  assert.match(tab.url, /^chrome-extension:\/\/oofeehjoocddelicpmnpbafmbalaakge\/sleep\.html\?/);
  assert.equal(env.registry()[String(lil.id)].slept, true);
  assert.equal(env.captures().size, 1);
  assert.ok(journalHas(env, "tabs.captureVisibleTab"));
});

test("unknown config fields are not required for the worker to apply known ones", async () => {
  const cfg = fixture("config-with-unknown-fields");
  const env = await boot();
  await env.deliver({
    type: "context",
    id: "ctx-unknown",
    defaultBrowser: cfg.defaultBrowser,
    sleep: cfg.sleep,
    unknownSectionProbe: cfg.unknownSectionProbe,
  });
  const { context } = await env.message({ action: "getContext" });
  assert.equal(context.sleep.whitelist.length, 1);
  assert.equal(context.sleep.whitelist[0], "Mail.Google.com");
  assert.equal(context.unknownSectionProbe, undefined);
});

test("new-window target from a lil is re-parented into a cascaded lil", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver(fixture("message-open-legacy"));
  const lil = env.windows().find((w) => w.type === "popup");
  const spawned = await env.chrome.tabs.create({
    windowId: normal.id,
    url: "https://spawned.example/",
    openerTabId: lil.tabs[0].id,
    active: true,
  });
  await env.createdNavigationTarget({
    tabId: spawned.id,
    sourceTabId: lil.tabs[0].id,
    url: "https://spawned.example/",
  });
  assert.ok(journalHas(env, "windows.create", (e) => e.create.tabId === spawned.id && e.create.type === "popup"));
  const cascaded = env.windows().find((w) => w.type === "popup" && w.id !== lil.id);
  assert.ok(cascaded);
  assert.equal(cascaded.focused, true);
  assert.ok(env.registry()[String(cascaded.id)]);
  assert.equal(cascaded.tabs.some((t) => t.id === spawned.id), true);
});

// ---------------------------------------------------------------------------
// Lifecycle entry paths (issue #5). Every create / adopt / restore path and the
// registry + focus effects it is required to produce.
// ---------------------------------------------------------------------------

test("restart restoration reopens parked lils unfocused, skips quit-expiry ones, and re-registers them", async () => {
  const parked = {
    41: {
      url: "https://keep.example/",
      bounds: { left: 120, top: 90, width: 900, height: 700 },
      expiry: 6,
      lastInteraction: 1,
    },
    42: {
      url: "https://gone.example/",
      bounds: { left: 200, top: 150, width: 900, height: 700 },
      expiry: "quit",
      lastInteraction: 1,
    },
    43: {
      url: "https://napping.example/",
      bounds: { left: 300, top: 250, width: 900, height: 700 },
      expiry: "never",
      lastInteraction: 1,
      slept: true,
      sleepCaptureKey: "43-1",
      originalUrl: "https://napping.example/",
    },
  };
  const env = await boot({ storage: { ephemeralWindows: parked } });
  await env.startup();

  const wins = env.windows();
  assert.equal(wins.length, 2, "quit-expiry lils are not restored");
  assert.equal(
    wins.every((w) => w.type === "popup" && w.focused === false),
    true,
    "restoration never steals focus"
  );
  assert.equal(
    journalHas(env, "windows.update", (e) => e.update.focused === true),
    false,
    "restoration issues no explicit focus"
  );

  const kept = wins.find((w) => w.tabs[0].url === "https://keep.example/");
  assert.equal(kept.left, 120);
  assert.equal(kept.top, 90);
  assert.equal(kept.width, 900);

  const napping = wins.find((w) => w.tabs[0].url !== "https://keep.example/");
  assert.match(napping.tabs[0].url, /\/sleep\.html\?/, "a napping lil reopens on its sleep page");

  const registry = env.registry();
  assert.equal(Object.keys(registry).length, 2);
  assert.equal(registry["41"], undefined, "restored lils are re-keyed by their new window ids");
  assert.equal(registry[String(kept.id)].url, "https://keep.example/");
  assert.equal(registry[String(kept.id)].expiry, 6);
  assert.equal(registry[String(napping.id)].url, "https://napping.example/", "a napping lil records its real url");
  assert.equal(registry[String(napping.id)].slept, true);
  assert.equal(registry[String(napping.id)].sleepCaptureKey, "43-1");
});

test("an incognito lil is focused, in-memory only, and never restored", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver({ type: "open", url: "https://private.example/", incognito: true, left: 10, top: 10 });
  await env.deliver({ type: "open", url: "https://normal.example/", left: 60, top: 60 });

  const secret = env.windows().find((w) => w.incognito);
  assert.ok(secret, "incognito open creates an incognito lil");
  assert.equal(secret.type, "popup");
  assert.ok(journalHas(env, "windows.update", (e) => e.windowId === secret.id && e.update.focused === true));

  const seen = await env.message({ action: "isEphemeral" }, sender(secret));
  assert.equal(seen.ephemeral, true, "it is a lil without a registry entry");
  assert.equal(seen.incognito, true);

  const registry = env.registry();
  assert.equal(registry[String(secret.id)], undefined, "incognito lils are never persisted");
  assert.equal(Object.keys(registry).length, 1, "only the persistent lil is registered");

  // Restart: the restored set is exactly what the persistent registry held.
  const restarted = await boot({ storage: { ephemeralWindows: registry } });
  await restarted.startup();
  assert.deepEqual(
    restarted.windows().map((w) => w.tabs[0].url),
    ["https://normal.example/"]
  );
});

test("without incognito access the incognito path falls back to a normal lil and hints why", async () => {
  const env = await boot({ incognitoAllowed: false });
  await env.deliver(fixture("message-context"));
  await env.deliver({ type: "open", url: "https://private.example/", incognito: true, left: 10, top: 10 });

  const wins = env.windows();
  assert.equal(wins.length, 1);
  assert.equal(wins[0].incognito, false);
  assert.ok(env.registry()[String(wins[0].id)], "the fallback lil is a normal, registered lil");
  assert.ok(journalHas(env, "tabs.sendMessage", (e) => e.message.action === "incognitoHint"));
  const pending = await env.message({ action: "pendingIncognitoHint" }, sender(wins[0]));
  assert.equal(pending.hint, true);
});

test("a failed lil creation registers nothing", async () => {
  // Fresh-lil path: the window never opens.
  const blocked = await boot({ rejectWindowCreate: (opts) => opts.type === "popup" });
  await blocked.deliver(fixture("message-context"));
  await blocked.deliver(fixture("message-open-legacy"));
  assert.equal(blocked.windows().length, 0);
  assert.deepEqual(Object.keys(blocked.registry()), [], "no registry entry for a lil that never opened");

  // Adopt path: the tab being adopted is already gone.
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.installed();
  const normal = await env.chrome.windows.create({ url: "https://mail.example/", type: "normal" });
  await env.clickMenu("send-to-lil", { id: 4242, windowId: normal.id, url: "https://mail.example/" });
  assert.equal(env.windows().some((w) => w.type === "popup"), false);
  assert.deepEqual(Object.keys(env.registry()), [], "no registry entry for an adoption that failed");
});

test("a failed incognito creation falls back to exactly one registered normal lil", async () => {
  const env = await boot({ rejectWindowCreate: (opts) => !!opts.incognito });
  await env.deliver(fixture("message-context"));
  await env.deliver({ type: "open", url: "https://private.example/", incognito: true, left: 10, top: 10 });

  const wins = env.windows();
  assert.equal(wins.length, 1);
  assert.equal(wins[0].incognito, false);
  assert.deepEqual(Object.keys(env.registry()), [String(wins[0].id)]);
  assert.ok(journalHas(env, "tabs.sendMessage", (e) => e.message.action === "incognitoHint"));
});

test("geometry maintenance never requests focus", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver({ type: "open", url: "https://a.example/", left: 10, top: 10 });
  const lil = env.windows()[0];
  const other = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });

  const before = env.journal().length;
  await env.chrome.windows.update(lil.id, { left: 40, top: 50, width: 800, height: 600 });
  await env.flush();

  const after = env.journal().slice(before);
  assert.equal(
    after.some((e) => e.op === "windows.update" && e.update && e.update.focused === true),
    false,
    "a bounds change must not raise the lil"
  );
  assert.equal(env.windows().find((w) => w.id === other.id).focused, true, "focus stays where the user left it");
  assert.equal(env.registry()[String(lil.id)].bounds.width, 800, "the bounds are still recorded");
});

test("suite runs without a live profile or the repo as cwd", async () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  process.chdir(os.tmpdir());
  process.env.HOME = path.join(os.tmpdir(), "lil-chromium-no-profile");
  try {
    const env = await boot();
    await env.deliver(fixture("message-open-legacy"));
    assert.equal(env.windows().length, 1);
    assert.equal(env.windows()[0].tabs[0].url, "https://example.com/docs");
  } finally {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  }
});
