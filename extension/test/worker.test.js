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
  assert.equal(context.primaryBrowser, "helium");
  assert.equal(context.primaryBrowserName, "Helium");
  assert.notEqual(context.browser, context.primaryBrowser);
  assert.equal(context.defaultBrowser, undefined);
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
    "ephemeralDefault",
    "fallbackBrowser",
    "hoverBar",
    "id",
    "knownBrowsers",
    "linkBehavior",
    "primaryBrowser",
    "primaryBrowserName",
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
  assert.equal(context.primaryBrowser, "brave");
  assert.equal(context.defaultBrowser, undefined);
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

test("v3 complete config fixture matches the context wire's config objects", async () => {
  const cfg = fixture("config-v3-complete");
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
  await env.blurBrowser();
  await env.deliver(fixture("message-open-prior-context"));
  const lil = env.windows().find((w) => w.type === "popup");
  await env.message({ action: "promote", dest: "host-tab" }, sender(lil));

  assert.ok(journalHas(env, "tabs.move", (e) => e.move.windowId === host.id));
  assert.equal(Object.keys(env.registry()).length, 0);
  const hostNow = env.windows().find((w) => w.id === host.id);
  assert.ok(hostNow.tabs.some((t) => t.url === "https://example.com/from-mail"));
  assert.equal(env.windows().some((w) => w.type === "popup"), false);
  assert.equal(
    env.outgoing().some((message) => message.type === "restore-focus"),
    false,
    "promotion is a lifecycle transfer, not a close"
  );
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

test("each lil restores its recorded prior context from a nested external-app chain", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.blurBrowser();
  await env.deliver(fixture("message-open-prior-context"));
  const first = env.windows()[0];

  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(first.id)].priorContext)), {
    kind: "external-app",
    pid: 4242,
    bundleId: "com.apple.mail",
  });

  await env.deliver({ type: "open", url: "https://nested.example/", left: 20, top: 20 });
  const second = env.windows().find((win) => win.id !== first.id);
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(second.id)].priorContext)), {
    kind: "lil",
    windowId: first.id,
  });

  await env.chrome.windows.remove(second.id);
  await env.flush();
  assert.equal(env.windows().find((win) => win.id === first.id).focused, true);

  await env.chrome.windows.remove(first.id);
  await env.flush();
  assert.deepEqual(env.outgoing().at(-1), fixture("message-restore-focus"));
  assert.deepEqual(Object.keys(env.registry()), []);
});

test("the Close lil action restores prior context exactly once before cleanup", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.blurBrowser();
  await env.deliver(fixture("message-open-prior-context"));
  const lil = env.windows()[0];

  await env.message({ action: "closeWindow" }, sender(lil));

  assert.equal(env.windows().length, 0);
  assert.equal(
    env.outgoing().filter((message) => message.type === "restore-focus").length,
    1,
    "one close event makes one restore request"
  );
  assert.deepEqual(Object.keys(env.registry()), []);
});

test("closing an unfocused lil after WINDOW_ID_NONE does not raise a browser window", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://related.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const lil = env.windows().find((win) => win.type === "popup");
  await env.blurBrowser();
  const before = env.journal().length;

  await env.chrome.windows.remove(lil.id);
  await env.flush();

  const after = env.journal().slice(before);
  assert.equal(
    after.some(
      (entry) =>
        entry.op === "windows.update" &&
        entry.windowId === normal.id &&
        entry.update.focused === true
    ),
    false
  );
  assert.equal(env.outgoing().some((message) => message.type === "restore-focus"), false);
});

test("a lil restores its exact related normal window despite later normal-window activity", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const related = await env.chrome.windows.create({ url: "https://related.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const lil = env.windows().find((win) => win.type === "popup");
  const unrelated = await env.chrome.windows.create({ url: "https://unrelated.example/", type: "normal" });
  await env.chrome.windows.update(lil.id, { focused: true });

  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(lil.id)].priorContext)), {
    kind: "normal-window",
    windowId: related.id,
  });

  await env.chrome.windows.remove(lil.id);
  await env.flush();
  assert.equal(env.windows().find((win) => win.id === related.id).focused, true);
  assert.equal(env.windows().find((win) => win.id === unrelated.id).focused, false);
});

test("a stale predecessor lil is ignored without focusing an unrelated normal window", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver({ type: "open", url: "https://first.example/", left: 10, top: 10 });
  const first = env.windows()[0];
  await env.deliver({ type: "open", url: "https://second.example/", left: 20, top: 20 });
  const second = env.windows().find((win) => win.id !== first.id);
  await env.chrome.windows.remove(first.id);
  const unrelated = await env.chrome.windows.create({ url: "https://unrelated.example/", type: "normal" });
  await env.chrome.windows.update(second.id, { focused: true });
  const before = env.journal().length;

  await env.chrome.windows.remove(second.id);
  await env.flush();

  const after = env.journal().slice(before);
  assert.equal(
    after.some(
      (entry) =>
        entry.op === "windows.update" &&
        entry.windowId === unrelated.id &&
        entry.update.focused === true
    ),
    false
  );
});

test("an unregistered native popup is not mislabeled as a normal-window predecessor", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.chrome.windows.create({ url: "https://auth.example/", type: "popup" });

  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });

  const lil = env.windows().find((win) => win.tabs[0].url === "https://lil.example/");
  assert.equal(env.registry()[String(lil.id)].priorContext, null);
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

test("automatic expiry of a focused lil restores prior context before cleanup", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.blurBrowser();
  await env.deliver(fixture("message-open-prior-context"));
  const lil = env.windows()[0];
  const registry = env.registry();
  registry[String(lil.id)].expiry = 1;
  registry[String(lil.id)].lastInteraction = Date.now() - 2 * 3600 * 1000;
  await env.chrome.storage.local.set({ ephemeralWindows: registry });

  await env.alarm();

  assert.equal(env.windows().length, 0);
  assert.equal(env.outgoing().filter((message) => message.type === "restore-focus").length, 1);
  assert.deepEqual(Object.keys(env.registry()), []);
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
    primaryBrowser: cfg.primaryBrowser,
    sleep: cfg.sleep,
    unknownSectionProbe: cfg.unknownSectionProbe,
  });
  const { context } = await env.message({ action: "getContext" });
  assert.equal(context.primaryBrowser, "helium");
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

test("a cascaded lil records its source lil despite incidental normal-window focus", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.blurBrowser();
  await env.deliver(fixture("message-open-prior-context"));
  const source = env.windows()[0];
  const incidental = await env.chrome.windows.create({ url: "https://incidental.example/", type: "normal" });
  const spawned = await env.chrome.tabs.create({
    windowId: incidental.id,
    url: "https://spawned.example/",
    openerTabId: source.tabs[0].id,
    active: true,
  });

  await env.createdNavigationTarget({
    tabId: spawned.id,
    sourceTabId: source.tabs[0].id,
    url: "https://spawned.example/",
  });

  const child = env.windows().find((win) => win.type === "popup" && win.id !== source.id);
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(child.id)].priorContext)), {
    kind: "lil",
    windowId: source.id,
  });
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

test("restart restoration remaps a nested lil chain and preserves its external root", async () => {
  const parked = {
    41: {
      url: "https://root.example/",
      bounds: { left: 100, top: 100, width: 900, height: 700 },
      expiry: "never",
      lastInteraction: 1,
      priorContext: { kind: "external-app", pid: 4242, bundleId: "com.apple.mail" },
    },
    42: {
      url: "https://child.example/",
      bounds: { left: 132, top: 132, width: 900, height: 700 },
      expiry: "never",
      lastInteraction: 1,
      priorContext: { kind: "lil", windowId: 41 },
    },
  };
  const env = await boot({ storage: { ephemeralWindows: parked } });
  await env.startup();
  const root = env.windows().find((win) => win.tabs[0].url === "https://root.example/");
  const child = env.windows().find((win) => win.tabs[0].url === "https://child.example/");

  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(child.id)].priorContext)), {
    kind: "lil",
    windowId: root.id,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(root.id)].priorContext)), {
    kind: "external-app",
    pid: 4242,
    bundleId: "com.apple.mail",
  });

  await env.chrome.windows.update(child.id, { focused: true });
  await env.chrome.windows.remove(child.id);
  await env.flush();
  assert.equal(env.windows().find((win) => win.id === root.id).focused, true);

  await env.chrome.windows.remove(root.id);
  await env.flush();
  assert.deepEqual(env.outgoing().at(-1), fixture("message-restore-focus"));
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

test("an incognito lil keeps its external predecessor in memory and restores it on close", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.blurBrowser();
  await env.deliver({ ...fixture("message-open-prior-context"), incognito: true });
  const lil = env.windows()[0];

  await env.chrome.windows.remove(lil.id);
  await env.flush();

  assert.deepEqual(Object.keys(env.registry()), []);
  assert.deepEqual(env.outgoing().at(-1), fixture("message-restore-focus"));
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

// ---------------------------------------------------------------------------
// Attributable new-tab conversion (issue #18). A browser-created tab (Command+T
// or a current-browser utility open) becomes a lil only when public events tie
// it to a focused lil: onCreated names an active, opener-less tab in an
// already-populated normal window, and onFocusChanged still names a registered
// lil as the focused Chromium window at that creation event.
// ---------------------------------------------------------------------------

test("a Command+T tab created active in a normal window while a lil is focused converts into a lil chained to it", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");
  assert.equal(source.focused, true);

  const created = await env.chrome.tabs.create({ windowId: normal.id, active: true, url: "chrome://newtab/" });
  await env.flush();

  const converted = env.windows().find((w) => w.type === "popup" && w.id !== source.id);
  assert.ok(converted, "the browser-created tab was adopted into a new lil");
  assert.equal(converted.focused, true);
  assert.equal(converted.tabs[0].id, created.id);
  assert.ok(journalHas(env, "windows.create", (e) => e.create.tabId === created.id && e.create.type === "popup"));

  const entry = env.registry()[String(converted.id)];
  assert.ok(entry, "the converted lil is registered through the shared lifecycle");
  assert.equal(entry.url, "chrome://newtab/");
  assert.deepEqual(JSON.parse(JSON.stringify(entry.priorContext)), {
    kind: "lil",
    windowId: source.id,
  });

  const hostNow = env.windows().find((w) => w.id === normal.id);
  assert.equal(hostNow.tabs.some((t) => t.id === created.id), false, "the tab left the normal window");
  assert.ok(env.registry()[String(source.id)], "the source lil remains registered");
});

test("a current-browser utility open while a lil is focused converts into a lil chained to it", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");

  const created = await env.chrome.tabs.create({
    windowId: normal.id,
    active: true,
    url: "https://utility.example/search?q=hello",
  });
  await env.flush();

  const converted = env.windows().find((w) => w.type === "popup" && w.id !== source.id);
  assert.ok(converted, "the utility tab was adopted into a new lil");
  assert.equal(converted.tabs[0].id, created.id);
  assert.equal(env.registry()[String(converted.id)].url, "https://utility.example/search?q=hello");
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(converted.id)].priorContext)), {
    kind: "lil",
    windowId: source.id,
  });
  assert.equal(converted.focused, true);
});

test("a background tab creation is never captured, even with a lil focused", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");
  assert.equal(source.focused, true);

  const created = await env.chrome.tabs.create({ windowId: normal.id, active: false, url: "https://bg.example/" });
  await env.flush();

  assert.equal(env.windows().filter((w) => w.type === "popup").length, 1, "no second lil was created");
  assert.equal(
    journalHas(env, "windows.create", (e) => e.create.tabId === created.id),
    false,
    "the background tab was never adopted"
  );
  const hostNow = env.windows().find((w) => w.id === normal.id);
  assert.ok(hostNow.tabs.some((t) => t.id === created.id), "the tab stayed in its normal window");
  assert.deepEqual(Object.keys(env.registry()), [String(source.id)]);
});

test("a link-spawned tab is owned by the new-window link flow, never the new-tab flow", async () => {
  const env = await boot();
  await env.deliver({ ...fixture("message-context"), linkBehavior: "same-lil" });
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");
  assert.equal(source.focused, true);

  const spawned = await env.chrome.tabs.create({
    windowId: normal.id,
    url: "https://spawned.example/",
    openerTabId: source.tabs[0].id,
    active: true,
  });
  await env.createdNavigationTarget({
    tabId: spawned.id,
    sourceTabId: source.tabs[0].id,
    url: "https://spawned.example/",
  });

  assert.equal(
    journalHas(env, "windows.create", (e) => e.create.tabId === spawned.id),
    false,
    "the new-tab flow never adopts an opener-attributed tab"
  );
  assert.equal(
    env.windows().filter((w) => w.type === "popup").length,
    1,
    "same-lil collapses the spawn into the source lil instead of converting"
  );
  const sourceNow = env.windows().find((w) => w.id === source.id);
  assert.equal(sourceNow.tabs[0].url, "https://spawned.example/");
  assert.equal(sourceNow.focused, true, "focus returned to the source lil");
});

test("a new tab after focus has already left the lil is left untouched", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");

  await env.chrome.windows.update(normal.id, { focused: true });
  const created = await env.chrome.tabs.create({ windowId: normal.id, active: true, url: "chrome://newtab/" });
  await env.flush();

  assert.equal(env.windows().filter((w) => w.type === "popup").length, 1, "the later tab was not converted");
  assert.equal(
    journalHas(env, "windows.create", (e) => e.create.tabId === created.id),
    false
  );
  const hostNow = env.windows().find((w) => w.id === normal.id);
  assert.ok(hostNow.tabs.some((t) => t.id === created.id));
  assert.deepEqual(Object.keys(env.registry()), [String(source.id)]);
});

test("a new tab after Chromium reports WINDOW_ID_NONE is left untouched", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");

  await env.blurBrowser();
  const created = await env.chrome.tabs.create({ windowId: normal.id, active: true, url: "https://stale.example/" });
  await env.flush();

  assert.equal(env.windows().filter((w) => w.type === "popup").length, 1);
  assert.equal(
    journalHas(env, "windows.create", (e) => e.create.tabId === created.id),
    false,
    "WINDOW_ID_NONE is not a lil source"
  );
  assert.ok(env.windows().find((w) => w.id === normal.id).tabs.some((t) => t.id === created.id));
  assert.deepEqual(Object.keys(env.registry()), [String(source.id)]);
});

test("a competing lil is ignored; conversion chains to the focused one", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://first.example/", left: 10, top: 10 });
  const first = env.windows().find((w) => w.type === "popup");
  await env.deliver({ type: "open", url: "https://second.example/", left: 40, top: 40 });
  const second = env.windows().find((w) => w.type === "popup" && w.id !== first.id);
  assert.equal(second.focused, true);

  const created = await env.chrome.tabs.create({ windowId: normal.id, active: true, url: "chrome://newtab/" });
  await env.flush();

  const converted = env.windows().find((w) => w.type === "popup" && w.id !== first.id && w.id !== second.id);
  assert.ok(converted);
  assert.equal(converted.tabs[0].id, created.id);
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(converted.id)].priorContext)), {
    kind: "lil",
    windowId: second.id,
  });
  assert.notEqual(env.registry()[String(converted.id)].priorContext.windowId, first.id);
});

test("a tab in a competing normal window is left untouched even with a lil focused", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const used = await env.chrome.windows.create({ url: "https://used.example/", type: "normal" });
  const other = await env.chrome.windows.create({ url: "https://other.example/", type: "normal" });
  await env.chrome.windows.update(used.id, { focused: true });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");
  assert.equal(source.focused, true);

  const created = await env.chrome.tabs.create({
    windowId: other.id,
    active: true,
    url: "https://unrelated.example/",
  });
  await env.flush();

  assert.equal(env.windows().filter((w) => w.type === "popup").length, 1, "the competing window's tab was not converted");
  assert.equal(
    journalHas(env, "windows.create", (e) => e.create.tabId === created.id),
    false
  );
  assert.ok(env.windows().find((w) => w.id === other.id).tabs.some((t) => t.id === created.id));
  assert.deepEqual(Object.keys(env.registry()), [String(source.id)]);
});

test("Command+T into the last-focused normal window still converts when another normal window exists", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const used = await env.chrome.windows.create({ url: "https://used.example/", type: "normal" });
  await env.chrome.windows.create({ url: "https://other.example/", type: "normal" });
  await env.chrome.windows.update(used.id, { focused: true });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");

  const created = await env.chrome.tabs.create({ windowId: used.id, active: true, url: "chrome://newtab/" });
  await env.flush();

  const converted = env.windows().find((w) => w.type === "popup" && w.id !== source.id);
  assert.ok(converted);
  assert.equal(converted.tabs[0].id, created.id);
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(converted.id)].priorContext)), {
    kind: "lil",
    windowId: source.id,
  });
});

test("the first tab of a new normal window is not converted just because a lil is focused", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");

  const brandNew = await env.chrome.windows.create({ url: "https://fresh.example/", type: "normal" });
  await env.flush();

  assert.equal(env.windows().filter((w) => w.type === "popup").length, 1);
  assert.ok(env.windows().find((w) => w.id === brandNew.id).tabs.some((t) => t.url === "https://fresh.example/"));
  assert.deepEqual(Object.keys(env.registry()), [String(source.id)]);
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
