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

function menu(env, id) {
  return env.menus().find((item) => item.id === id);
}

const NAP_PAGE = /^chrome-extension:\/\/oofeehjoocddelicpmnpbafmbalaakge\/sleep\.html\?/;
const ORIGINAL_PAGE_TITLE = "Example Docs";

function napParams(url) {
  return new URL(url).searchParams;
}

function journalIndex(env, pred) {
  return env.journal().findIndex(pred);
}

async function openTitledLil(env, { url, title = ORIGINAL_PAGE_TITLE, incognito = false } = {}) {
  await env.deliver(fixture("message-context"));
  if (url || incognito) {
    await env.deliver({
      type: "open",
      url: url || "https://example.com/docs",
      left: 10,
      top: 10,
      ...(incognito ? { incognito: true } : {}),
    });
  } else {
    await env.deliver(fixture("message-open-legacy"));
  }
  const lil = env.windows().find((w) => (incognito ? w.incognito : w.type === "popup")) || env.windows()[0];
  await env.setTabState(lil.tabs[0].id, { title });
  return lil;
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
  assert.equal(context.hoverBar.revealHeight, 15, "additive v0.4 default (issue #12)");
});

test("v3 complete config fixture matches the context wire's config objects", async () => {
  const cfg = fixture("config-v3-complete");
  const wire = fixture("message-context");
  assert.equal(cfg.sleep.afterMinutes, wire.sleep.afterMinutes);
  assert.equal(cfg.searchEngine.name, wire.searchEngine.name);
  assert.equal(cfg.hoverBar.style, wire.hoverBar.style);
  assert.equal(cfg.hoverBar.revealHeight, wire.hoverBar.revealHeight);

  const env = await boot();
  await env.deliver(wire);
  const { context } = await env.message({ action: "getContext" });
  assert.equal(context.sleep.afterMinutes, cfg.sleep.afterMinutes);
  assert.equal(context.searchEngine.template, cfg.searchEngine.template);
  assert.equal(context.hoverBar.tint, cfg.hoverBar.tint);
  assert.equal(context.hoverBar.revealHeight, cfg.hoverBar.revealHeight);
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

test("closing a normal window the user once came from does not rewrite a lil's prior context", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://primary.example/", type: "normal", focused: true });
  // An ordinary tab close leaves the window open.
  const tab = await env.chrome.tabs.create({ windowId: normal.id, url: "https://primary.example/2" });
  await env.chrome.tabs.remove(tab.id);
  await env.blurBrowser();
  await env.deliver({ type: "open", url: "https://example.com/docs", left: 10, top: 10 });
  const lil = env.windows().find((w) => w.type === "popup");
  // The user visits the primary window, comes back to the lil, then leaves for another app.
  await env.chrome.windows.update(normal.id, { focused: true });
  await env.chrome.windows.update(lil.id, { focused: true });
  await env.blurBrowser();

  await env.chrome.windows.remove(normal.id);
  await env.flush();

  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(lil.id)].priorContext)), {
    kind: "normal-window",
    windowId: normal.id,
  });
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

// Live trace 2026-09-17: the host had 18–26 ms between the extension's restore
// request and Chromium ordering the closing window out. A registry read on the
// way costs a storage round trip the flash of the sibling window fits inside.
test("a focused lil's external-app restoration is posted at tab removal without a storage round trip", async () => {
  let gate = null;
  const env = await boot({ storageGate: () => gate });
  await env.deliver(fixture("message-context"));
  await env.blurBrowser();
  await env.deliver(fixture("message-open-prior-context"));
  const lil = env.windows()[0];
  const requestsBefore = env.outgoing().filter((m) => m.type === "restore-focus").length;

  // From here every storage read hangs until released.
  let release;
  gate = new Promise((resolve) => (release = resolve));
  const closing = env.chrome.windows.remove(lil.id);
  await env.flush();

  assert.deepEqual(env.outgoing().at(-1), fixture("message-restore-focus"), "restored while storage was still out");

  release();
  gate = null;
  await closing;
  await env.flush();
  assert.equal(env.outgoing().filter((m) => m.type === "restore-focus").length, requestsBefore + 1, "and only once");
  assert.deepEqual(Object.keys(env.registry()), []);
});

// A lil briefly holds two tabs during a wake swap; only the removal that
// empties it is a close.
test("removing one tab of a two-tab lil restores nothing, and closing its last tab restores once", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.blurBrowser();
  await env.deliver(fixture("message-open-prior-context"));
  const lil = env.windows()[0];
  const second = await env.chrome.tabs.create({ windowId: lil.id, url: "https://example.com/second" });
  const restoreRequests = () => env.outgoing().filter((m) => m.type === "restore-focus").length;

  await env.closeTab(second.id);

  assert.equal(env.windows().length, 1, "the lil stays open");
  assert.equal(restoreRequests(), 0, "a tab close inside a live lil restores nothing");
  assert.ok(env.registry()[String(lil.id)], "and the lil stays registered");

  await env.closeTab(lil.tabs[0].id);

  assert.equal(env.windows().length, 0);
  assert.equal(restoreRequests(), 1, "the close that empties the lil restores once");
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

test("a lil's prior context follows the normal window the user came from, not the one it was created from", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const related = await env.chrome.windows.create({ url: "https://related.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const lil = env.windows().find((win) => win.type === "popup");
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(lil.id)].priorContext)), {
    kind: "normal-window",
    windowId: related.id,
  });

  // The user opens another normal window, then comes back to the lil.
  const later = await env.chrome.windows.create({ url: "https://later.example/", type: "normal" });
  await env.chrome.windows.update(lil.id, { focused: true });
  await env.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(lil.id)].priorContext)), {
    kind: "normal-window",
    windowId: later.id,
  });

  await env.chrome.windows.remove(lil.id);
  await env.flush();
  assert.equal(env.windows().find((win) => win.id === later.id).focused, true);
  assert.equal(env.windows().find((win) => win.id === related.id).focused, false);
});

test("explicit switching between lils updates the prior context, so closing returns to the live lil", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.blurBrowser();
  await env.deliver(fixture("message-open-prior-context"));
  const a = env.windows()[0];
  await env.deliver({ type: "open", url: "https://b.example/", left: 20, top: 20 });
  const b = env.windows().find((win) => win.id !== a.id);

  // A -> B -> A by the user's hand: A's prior context is now B.
  await env.chrome.windows.update(a.id, { focused: true });
  await env.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(a.id)].priorContext)), {
    kind: "lil",
    windowId: b.id,
  });

  await env.chrome.windows.remove(a.id);
  await env.flush();
  assert.equal(env.windows().find((win) => win.id === b.id).focused, true);
  assert.equal(
    env.outgoing().some((message) => message.type === "restore-focus"),
    false,
    "the creation-time external app is no longer A's prior context"
  );
});

test("a stale prior-context lil is ignored without focusing an unrelated normal window", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver({ type: "open", url: "https://first.example/", left: 10, top: 10 });
  const first = env.windows()[0];
  await env.deliver({ type: "open", url: "https://second.example/", left: 20, top: 20 });
  const second = env.windows().find((win) => win.id !== first.id);
  await env.chrome.windows.remove(first.id);
  const unrelated = await env.chrome.windows.create({
    url: "https://unrelated.example/",
    type: "normal",
    focused: false,
  });
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

test("a failed incognito context-menu create explains without opening the URL", async () => {
  const env = await boot({ rejectWindowCreate: (opts) => !!opts.incognito });
  await env.deliver(fixture("message-context"));
  await env.installed();
  const normal = await env.chrome.windows.create({ url: "https://mail.example/", type: "normal" });
  const tab = { id: normal.tabs[0].id, windowId: normal.id, url: normal.tabs[0].url };

  await env.clickMenu("open-link-incognito-lil", tab, { linkUrl: "https://secret.example/" });

  assert.equal(
    env.windows().some((w) => w.tabs.some((t) => t.url === "https://secret.example/")),
    false
  );
  assert.equal(env.windows().length, 1);
  assert.ok(
    journalHas(env, "tabs.sendMessage", (e) => e.tabId === tab.id && e.message.action === "incognitoHint")
  );
});

test("Open link in incognito lil without access explains and does not de-privatize the URL", async () => {
  const env = await boot({ incognitoAllowed: false });
  await env.deliver(fixture("message-context"));
  await env.installed();
  const normal = await env.chrome.windows.create({ url: "https://mail.example/", type: "normal" });
  const tab = { id: normal.tabs[0].id, windowId: normal.id, url: normal.tabs[0].url };

  await env.clickMenu("open-link-incognito-lil", tab, { linkUrl: "https://secret.example/" });

  assert.equal(
    env.windows().some((w) => w.tabs.some((t) => t.url === "https://secret.example/")),
    false,
    "the URL must not open in a normal lil"
  );
  assert.equal(env.windows().length, 1);
  assert.equal(env.windows()[0].incognito, false);
  assert.deepEqual(Object.keys(env.registry()), []);
  assert.ok(
    journalHas(env, "tabs.sendMessage", (e) => e.tabId === tab.id && e.message.action === "incognitoHint")
  );
});

test("context-menu incognito explain does not leave a pending mount hint", async () => {
  const env = await boot({ incognitoAllowed: false });
  await env.deliver(fixture("message-context"));
  await env.installed();
  const normal = await env.chrome.windows.create({ url: "https://mail.example/", type: "normal" });
  const tab = { id: normal.tabs[0].id, windowId: normal.id, url: normal.tabs[0].url };

  await env.clickMenu("open-link-incognito-lil", tab, { linkUrl: "https://secret.example/" });

  assert.ok(
    journalHas(env, "tabs.sendMessage", (e) => e.tabId === tab.id && e.message.action === "incognitoHint")
  );
  const pending = await env.message({ action: "pendingIncognitoHint" }, sender(env.windows()[0]));
  assert.equal(pending.hint, false);
});

test("Open link in incognito lil from a normal tab creates an unregistered incognito lil", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.installed();
  const normal = await env.chrome.windows.create({ url: "https://mail.example/", type: "normal" });
  const tab = { id: normal.tabs[0].id, windowId: normal.id, url: normal.tabs[0].url };

  await env.clickMenu("open-link-incognito-lil", tab, { linkUrl: "https://private.example/" });

  const secret = env.windows().find((w) => w.incognito);
  assert.ok(secret, "incognito opening does not require the source to be a lil");
  assert.equal(secret.type, "popup");
  assert.equal(secret.focused, true);
  assert.equal(secret.tabs[0].url, "https://private.example/");
  assert.equal(env.registry()[String(secret.id)], undefined);
  assert.equal(env.windows().find((w) => w.id === normal.id).tabs[0].url, "https://mail.example/");
});

test("Open link in new lil from a registered lil names that lil as predecessor", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.installed();
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows()[0];
  const tab = { id: source.tabs[0].id, windowId: source.id, url: source.tabs[0].url };

  await env.clickMenu("open-link-new-lil", tab, { linkUrl: "https://child.example/" });

  const child = env.windows().find((w) => w.id !== source.id);
  assert.ok(child);
  assert.equal(child.focused, true);
  assert.equal(child.tabs[0].url, "https://child.example/");
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(child.id)].priorContext)), {
    kind: "lil",
    windowId: source.id,
  });
});

test("Open link in new lil from a normal tab creates a focused registered lil", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.installed();
  const normal = await env.chrome.windows.create({ url: "https://mail.example/", type: "normal" });
  const tab = { id: normal.tabs[0].id, windowId: normal.id, url: normal.tabs[0].url };

  await env.clickMenu("open-link-new-lil", tab, { linkUrl: "https://article.example/" });

  const lil = env.windows().find((w) => w.type === "popup");
  assert.ok(lil, "a lil opens even though the source is not a lil");
  assert.equal(lil.focused, true);
  assert.equal(lil.tabs[0].url, "https://article.example/");
  assert.ok(env.registry()[String(lil.id)]);
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(lil.id)].priorContext)), {
    kind: "normal-window",
    windowId: normal.id,
  });
  assert.equal(env.windows().find((w) => w.id === normal.id).tabs[0].url, "https://mail.example/");
  assert.ok(journalHas(env, "windows.update", (e) => e.windowId === lil.id && e.update.focused === true));
});

test("install does not show context-dependent menus until policy decides", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.installed();

  for (const id of [
    "open-link-this-lil",
    "open-link-new-lil",
    "open-link-incognito-lil",
    "sleep-this-lil",
    "toggle-whitelist",
    "send-to-lil",
    "send-tab-to-lil",
  ]) {
    assert.equal(menu(env, id).visible, false, `${id} must stay hidden before the first policy decision`);
  }
});

test("install with an existing page applies the shared policy before any item can appear", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.chrome.windows.create({ url: "https://mail.example/", type: "normal" });
  await env.installed();

  assert.equal(menu(env, "open-link-this-lil").visible, false);
  assert.equal(menu(env, "send-to-lil").visible, true);
  assert.equal(menu(env, "open-link-new-lil").visible, true);
  assert.equal(menu(env, "open-link-incognito-lil").visible, true);
  assert.equal(menu(env, "sleep-this-lil").visible, false);
});

test("Open link in new lil and incognito lil are offered on normal and registered-lil pages", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.installed();

  const normal = await env.chrome.windows.create({ url: "https://mail.example/", type: "normal" });
  assert.equal(menu(env, "open-link-new-lil").visible, true);
  assert.equal(menu(env, "open-link-incognito-lil").visible, true);
  assert.equal(menu(env, "open-link-this-lil").visible, false);
  assert.equal(menu(env, "send-to-lil").visible, true);

  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  assert.equal(menu(env, "open-link-new-lil").visible, true);
  assert.equal(menu(env, "open-link-incognito-lil").visible, true);
  assert.equal(menu(env, "open-link-this-lil").visible, true);
  assert.equal(menu(env, "send-to-lil").visible, false);
  assert.equal(menu(env, "sleep-this-lil").visible, true);
  assert.ok(env.windows().some((w) => w.id === normal.id));
});

test("Open link in this lil navigates the current registered lil", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.installed();
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const lil = env.windows()[0];
  const tab = { id: lil.tabs[0].id, windowId: lil.id, url: lil.tabs[0].url };

  assert.equal(menu(env, "open-link-this-lil").visible, true);

  await env.clickMenu("open-link-this-lil", tab, { linkUrl: "https://next.example/" });
  assert.equal(env.windows().find((w) => w.id === lil.id).tabs[0].url, "https://next.example/");
  assert.equal(env.windows().length, 1);
  assert.ok(env.registry()[String(lil.id)]);
});

test("Open link in this lil is hidden and inert outside a registered lil", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.installed();
  const normal = await env.chrome.windows.create({ url: "https://mail.example/", type: "normal" });
  const tab = { id: normal.tabs[0].id, windowId: normal.id, url: normal.tabs[0].url };

  assert.equal(menu(env, "open-link-this-lil").visible, false);

  await env.clickMenu("open-link-this-lil", tab, { linkUrl: "https://other.example/" });
  assert.equal(env.windows().find((w) => w.id === normal.id).tabs[0].url, "https://mail.example/");
  assert.equal(
    env.windows().some((w) => w.tabs.some((t) => t.url === "https://other.example/")),
    false
  );
});

test("incognito menus omit this-lil, new-lil, and send so the URL stays private", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.installed();

  const privateWin = await env.chrome.windows.create({
    url: "https://private.example/",
    type: "normal",
    incognito: true,
  });
  const privateTab = {
    id: privateWin.tabs[0].id,
    windowId: privateWin.id,
    url: privateWin.tabs[0].url,
    incognito: true,
  };
  assert.equal(menu(env, "open-link-this-lil").visible, false);
  assert.equal(menu(env, "open-link-new-lil").visible, false);
  assert.equal(menu(env, "send-to-lil").visible, false);
  assert.equal(menu(env, "send-tab-to-lil").visible, false);
  assert.equal(menu(env, "open-link-incognito-lil").visible, true);

  await env.clickMenu("open-link-new-lil", privateTab, { linkUrl: "https://leaked.example/" });
  await env.clickMenu("send-to-lil", privateTab);
  assert.equal(
    env.windows().some((w) => w.tabs.some((t) => t.url === "https://leaked.example/")),
    false
  );
  assert.equal(env.windows().filter((w) => w.type === "popup").length, 0);

  await env.deliver({ type: "open", url: "https://secret-lil.example/", incognito: true, left: 10, top: 10 });
  const secretLil = env.windows().find((w) => w.type === "popup" && w.incognito);
  assert.ok(secretLil);
  assert.equal(menu(env, "open-link-this-lil").visible, false);
  assert.equal(menu(env, "open-link-new-lil").visible, false);
  assert.equal(menu(env, "send-to-lil").visible, false);
  assert.equal(menu(env, "sleep-this-lil").visible, false);
  assert.equal(menu(env, "open-link-incognito-lil").visible, true);

  const secretTab = {
    id: secretLil.tabs[0].id,
    windowId: secretLil.id,
    url: secretLil.tabs[0].url,
    incognito: true,
  };
  await env.clickMenu("open-link-this-lil", secretTab, { linkUrl: "https://elsewhere.example/" });
  assert.equal(env.windows().find((w) => w.id === secretLil.id).tabs[0].url, "https://secret-lil.example/");
});

test("a throwing tab-context create still loads the other menus", async () => {
  const env = await boot({ tabContext: "throws" });
  await env.deliver(fixture("message-context"));
  await env.installed();
  await env.chrome.windows.create({ url: "https://mail.example/", type: "normal" });

  assert.equal(menu(env, "send-tab-to-lil"), undefined);
  assert.ok(menu(env, "send-to-lil"));
  assert.ok(menu(env, "open-link-new-lil"));
  assert.ok(menu(env, "open-link-this-lil"));
  assert.ok(menu(env, "sleep-this-lil"));
});

test("unsupported tab context omits Send Tab to Lil without blocking other menus", async () => {
  const env = await boot({ tabContext: "unsupported" });
  await env.deliver(fixture("message-context"));
  await env.installed();
  const normal = await env.chrome.windows.create({ url: "https://mail.example/", type: "normal" });

  assert.equal(menu(env, "send-tab-to-lil"), undefined);
  assert.ok(menu(env, "send-to-lil"));
  assert.equal(menu(env, "send-to-lil").visible, true);
  assert.ok(menu(env, "open-link-new-lil"));
  assert.equal(menu(env, "open-link-new-lil").visible, true);
  assert.ok(menu(env, "open-link-incognito-lil"));

  await env.clickMenu("send-to-lil", {
    id: normal.tabs[0].id,
    windowId: normal.id,
    url: normal.tabs[0].url,
  });
  const lil = env.windows().find((w) => w.type === "popup");
  assert.ok(lil, "page Send to lil still works when the tab-strip action is absent");
  assert.ok(env.registry()[String(lil.id)]);
});

test("Send Tab to Lil reparents the clicked tab through the shared lifecycle", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.installed();
  const normal = await env.chrome.windows.create({ url: "https://keep.example/", type: "normal" });
  const extra = await env.chrome.tabs.create({
    windowId: normal.id,
    url: "https://move.example/",
    active: true,
  });
  const item = menu(env, "send-tab-to-lil");
  assert.ok(item, "tab-strip action is registered");
  assert.deepEqual(JSON.parse(JSON.stringify(item.contexts)), ["tab"]);
  assert.equal(item.title, "Send Tab to Lil");

  await env.clickMenu("send-tab-to-lil", { id: extra.id, windowId: normal.id, url: extra.url });

  const lil = env.windows().find((w) => w.type === "popup");
  assert.ok(lil);
  assert.equal(lil.focused, true);
  assert.equal(lil.tabs[0].url, "https://move.example/");
  assert.ok(env.registry()[String(lil.id)]);
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(lil.id)].priorContext)), {
    kind: "normal-window",
    windowId: normal.id,
  });
  const leftover = env.windows().find((w) => w.id === normal.id);
  assert.ok(leftover, "the source window keeps its other tab");
  assert.equal(leftover.tabs[0].url, "https://keep.example/");
});

test("Send to lil is hidden and inert inside a registered lil", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.installed();
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const lil = env.windows()[0];
  const tab = { id: lil.tabs[0].id, windowId: lil.id, url: lil.tabs[0].url };

  assert.equal(menu(env, "send-to-lil").visible, false);
  await env.clickMenu("send-to-lil", tab);
  assert.equal(env.windows().length, 1);
  assert.equal(env.windows()[0].id, lil.id);
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

test("entering Lil Nap captures the visible lil and records original URL, title, and capture identity before releasing the document", async () => {
  const env = await boot();
  const lil = await openTitledLil(env);
  const originalUrl = lil.tabs[0].url;

  await env.message({ action: "sleepThisLil" }, sender(lil));

  const tab = env.windows()[0].tabs[0];
  const entry = env.registry()[String(lil.id)];
  const captures = env.captures();

  assert.equal(originalUrl, "https://example.com/docs");
  assert.match(tab.url, NAP_PAGE);
  assert.notEqual(tab.url, originalUrl);
  assert.equal(entry.slept, true);
  assert.equal(entry.originalUrl, originalUrl);
  assert.equal(entry.originalTitle, ORIGINAL_PAGE_TITLE);
  assert.equal(typeof entry.sleepCaptureKey, "string");
  assert.ok(entry.sleepCaptureKey.length > 0);
  assert.equal(captures.size, 1);
  assert.ok(captures.has(entry.sleepCaptureKey));
  assert.equal(napParams(tab.url).get("k"), entry.sleepCaptureKey);
  assert.equal(napParams(tab.url).get("u"), originalUrl);
  assert.equal(napParams(tab.url).get("tint"), "#3311aa", "the configured tint travels with the entry inputs");
  assert.ok(journalHas(env, "tabs.captureVisibleTab"));

  const capturedAt = journalIndex(env, (e) => e.op === "tabs.captureVisibleTab");
  const releasedAt = journalIndex(
    env,
    (e) =>
      (e.op === "tabs.update" && String(e.update && e.update.url).includes("sleep.html")) ||
      (e.op === "scripting.executeScript" && (e.args || []).some((a) => String(a).includes("sleep.html")))
  );
  assert.ok(capturedAt >= 0 && releasedAt > capturedAt, "capture is stored before the original document is released");
});

test("the napping document title is the original page title prefixed with the sleeping symbol", async () => {
  const env = await boot();
  const lil = await openTitledLil(env);

  await env.message({ action: "sleepThisLil" }, sender(lil));

  const tab = env.windows()[0].tabs[0];
  assert.match(tab.url, NAP_PAGE);
  assert.equal(napParams(tab.url).get("t"), ORIGINAL_PAGE_TITLE);
  assert.equal(tab.title, "💤 Example Docs");
});

test("the nap document replaces rather than pollutes back/forward history", async () => {
  const env = await boot();
  const lil = await openTitledLil(env);
  const tabId = lil.tabs[0].id;
  const originalUrl = lil.tabs[0].url;
  assert.deepEqual(env.sessionHistory(tabId), [originalUrl]);

  await env.message({ action: "sleepThisLil" }, sender(lil));

  const tab = env.windows()[0].tabs[0];
  assert.match(tab.url, NAP_PAGE);
  assert.deepEqual(env.sessionHistory(tabId), [tab.url]);
  assert.equal(env.sessionHistory(tabId).includes(originalUrl), false);
});

// Rollback oracle: a failed entry leaves the live document truthful — original
// URL and history untouched, no nap fields on the registry, no stored capture,
// and no history-pushing fallback navigation.
function assertTruthfulRollback(env, lil, reply) {
  const originalUrl = "https://example.com/docs";
  const tabId = lil.tabs[0].id;
  assert.equal(reply.ok, false, "entry reports failure");
  const tab = env.windows().find((w) => w.id === lil.id).tabs[0];
  assert.equal(tab.url, originalUrl, "the live document is left untouched");
  assert.equal(tab.title, ORIGINAL_PAGE_TITLE);
  assert.deepEqual(env.sessionHistory(tabId), [originalUrl], "no nap URL sits on history");
  const entry = env.registry()[String(lil.id)];
  assert.ok(entry, "the lil stays registered as a live lil");
  assert.equal(entry.slept, undefined);
  assert.equal(entry.sleepCaptureKey, undefined);
  assert.equal(entry.originalUrl, undefined);
  assert.equal(entry.originalTitle, undefined);
  assert.equal(entry.url, originalUrl);
  assert.equal(env.captures().size, 0, "the fresh capture is rolled back");
  assert.equal(
    journalHas(env, "tabs.update", (e) => String(e.update && e.update.url).includes("sleep.html")),
    false,
    "entry never degrades to history-pushing navigation"
  );
}

test("when document replacement is unavailable, Lil Nap entry fails truthfully and rolls back nap state", async () => {
  const env = await boot({ scripting: false }); // scripting permission absent
  const lil = await openTitledLil(env);

  const reply = await env.message({ action: "sleepThisLil" }, sender(lil));

  assert.ok(journalHas(env, "tabs.captureVisibleTab"), "capture was prepared before release");
  assertTruthfulRollback(env, lil, reply);
});

test("when document replacement fails, Lil Nap entry fails truthfully and rolls back nap state", async () => {
  const env = await boot({ rejectScripting: () => true });
  const lil = await openTitledLil(env);

  const reply = await env.message({ action: "sleepThisLil" }, sender(lil));

  assert.ok(journalHas(env, "tabs.captureVisibleTab"), "capture was prepared before release");
  assertTruthfulRollback(env, lil, reply);
});

test("incognito lils are never captured or placed into Lil Nap", async () => {
  const env = await boot();
  const lil = await openTitledLil(env, { url: "https://private.example/", title: "Secret", incognito: true });
  assert.equal(lil.incognito, true);
  assert.equal(lil.tabs[0].url, "https://private.example/");

  await env.message({ action: "sleepThisLil" }, sender(lil));

  const tab = env.windows().find((w) => w.incognito).tabs[0];
  assert.equal(tab.url, "https://private.example/");
  assert.equal(tab.title, "Secret");
  assert.equal(env.captures().size, 0);
  assert.equal(env.registry()[String(lil.id)], undefined);
  assert.equal(journalHas(env, "tabs.captureVisibleTab"), false);
  assert.equal(
    journalHas(env, "scripting.executeScript", (e) => (e.args || []).some((a) => String(a).includes("sleep.html"))),
    false
  );
});

test("a browser restart restores a napping lil as a nap document without live-loading the original page", async () => {
  const parked = {
    43: {
      url: "https://napping.example/",
      bounds: { left: 300, top: 250, width: 900, height: 700 },
      expiry: "never",
      lastInteraction: 1,
      slept: true,
      sleepCaptureKey: "43-1",
      originalUrl: "https://napping.example/",
      originalTitle: "Napping Example",
    },
  };
  const env = await boot({ storage: { ephemeralWindows: parked } });
  await env.startup();

  const wins = env.windows();
  assert.equal(wins.length, 1);
  const tab = wins[0].tabs[0];
  assert.match(tab.url, NAP_PAGE);
  assert.equal(napParams(tab.url).get("k"), "43-1");
  assert.equal(napParams(tab.url).get("u"), "https://napping.example/");
  assert.equal(napParams(tab.url).get("t"), "Napping Example");
  assert.equal(tab.title, "💤 Napping Example");
  assert.deepEqual(env.sessionHistory(tab.id), [tab.url]);
  assert.equal(
    journalHas(env, "windows.create", (e) => e.create.url === "https://napping.example/"),
    false,
    "restore must not live-load the original page"
  );
  assert.ok(journalHas(env, "windows.create", (e) => String(e.create && e.create.url).includes("sleep.html")));

  const entry = env.registry()[String(wins[0].id)];
  assert.equal(entry.url, "https://napping.example/");
  assert.equal(entry.originalUrl, "https://napping.example/");
  assert.equal(entry.originalTitle, "Napping Example");
  assert.equal(entry.slept, true);
  assert.equal(entry.sleepCaptureKey, "43-1");
  assert.equal(tab.discarded, false);
  assert.equal(tab.frozen, false);
});

test("a browser restart rebuilds the nap page with the current configured tint, defaulting only when none is configured", async () => {
  const parked = {
    43: {
      url: "https://napping.example/",
      bounds: { left: 300, top: 250, width: 900, height: 700 },
      expiry: "never",
      lastInteraction: 1,
      slept: true,
      sleepCaptureKey: "43-1",
      originalUrl: "https://napping.example/",
      originalTitle: "Napping Example",
    },
  };

  // The configured tint survives the restart via the cached context.
  const configured = await boot({ storage: { ephemeralWindows: parked } });
  await configured.deliver(fixture("message-context")); // sleep.tint "#3311aa"
  await configured.startup();
  const configuredTab = configured.windows()[0].tabs[0];
  assert.match(configuredTab.url, NAP_PAGE);
  assert.equal(napParams(configuredTab.url).get("tint"), "#3311aa");

  // Configuration supplies no tint: the existing default applies.
  const unconfigured = await boot({ storage: { ephemeralWindows: parked } });
  await unconfigured.startup();
  const defaultTab = unconfigured.windows()[0].tabs[0];
  assert.match(defaultTab.url, NAP_PAGE);
  assert.equal(napParams(defaultTab.url).get("tint"), "purple");
});

test("registry and capture state distinguish Lil Nap from native discard and freeze", async () => {
  // Deterministic seam: Node fake Chrome has no Memory Saver and no Drowzy.
  // discarded/frozen are public tab flags applied without naming an actor.
  // Real-browser control: disposable profile with Memory Saver off and Drowzy
  // disabled; separate controls may enable each actor to confirm the same
  // oracle (nap URL + discarded==false vs original URL + discarded==true vs
  // original URL + frozen==true) without attributing the discarder.

  const env = await boot();
  await env.deliver(fixture("message-context"));

  await env.deliver({ type: "open", url: "https://nap.example/", left: 10, top: 10 });
  const nappingLil = env.windows()[0];
  await env.setTabState(nappingLil.tabs[0].id, { title: "Nap Me" });
  await env.message({ action: "sleepThisLil" }, sender(nappingLil));

  await env.deliver({ type: "open", url: "https://discard.example/", left: 40, top: 40 });
  const discardedLil = env.windows().find((w) => w.tabs[0].url === "https://discard.example/");
  await env.setTabState(discardedLil.tabs[0].id, { discarded: true, title: "Discarded Page" });

  await env.deliver({ type: "open", url: "https://frozen.example/", left: 70, top: 70 });
  const frozenLil = env.windows().find((w) => w.tabs[0].url === "https://frozen.example/");
  await env.setTabState(frozenLil.tabs[0].id, { frozen: true, title: "Frozen Page" });

  const napTab = env.windows().find((w) => w.id === nappingLil.id).tabs[0];
  const napEntry = env.registry()[String(nappingLil.id)];
  assert.match(napTab.url, NAP_PAGE);
  assert.equal(napTab.discarded, false);
  assert.equal(napTab.frozen, false);
  assert.equal(napEntry.slept, true);
  assert.equal(napEntry.originalUrl, "https://nap.example/");
  assert.ok(env.captures().has(napEntry.sleepCaptureKey));

  const discardedTab = env.windows().find((w) => w.id === discardedLil.id).tabs[0];
  const discardedEntry = env.registry()[String(discardedLil.id)];
  assert.equal(discardedTab.url, "https://discard.example/");
  assert.equal(discardedTab.discarded, true);
  assert.equal(discardedTab.frozen, false);
  assert.equal(discardedEntry.slept, undefined);
  assert.equal(discardedEntry.sleepCaptureKey, undefined);
  assert.match(discardedTab.url, /^https:\/\/discard\.example\//);

  const frozenTab = env.windows().find((w) => w.id === frozenLil.id).tabs[0];
  const frozenEntry = env.registry()[String(frozenLil.id)];
  assert.equal(frozenTab.url, "https://frozen.example/");
  assert.equal(frozenTab.frozen, true);
  assert.equal(frozenTab.discarded, false);
  assert.equal(frozenEntry.slept, undefined);
  assert.notEqual(frozenTab.url, napTab.url);
  assert.equal(journalHas(env, "tabs.discard"), false);
});

test("the page context menu action is Let This Lil Nap", async () => {
  const env = await boot();
  await env.installed();
  const lil = await openTitledLil(env);
  await env.chrome.windows.update(lil.id, { focused: true });
  await env.flush();

  const item = env.menus().find((m) => m.id === "sleep-this-lil");
  assert.ok(item);
  assert.equal(item.title, "Let This Lil Nap");
  assert.equal(item.visible, true);
});

test("the whitelist context menu uses napping language", async () => {
  const env = await boot();
  await env.installed();
  const item = () => env.menus().find((m) => m.id === "toggle-whitelist");
  assert.equal(item().title, "Never nap this site");

  const lil = await openTitledLil(env);
  await env.chrome.windows.update(lil.id, { focused: true });
  await env.flush();
  assert.equal(item().title, "Never nap example.com");

  await env.clickMenu("toggle-whitelist", { id: lil.tabs[0].id, windowId: lil.id, url: lil.tabs[0].url });
  assert.equal(item().title, "Allow napping example.com");
});

async function applySleepConfig(env, sleepPatch) {
  const wire = fixture("message-context");
  await env.deliver({
    ...wire,
    sleep: { ...wire.sleep, ...sleepPatch },
  });
}

async function parkIdle(env, lil, idleMinutes) {
  const registry = env.registry();
  registry[String(lil.id)].lastInteraction = Date.now() - idleMinutes * 60 * 1000;
  await env.chrome.storage.local.set({ ephemeralWindows: registry });
}

function lilTab(env, lil) {
  return env.windows().find((w) => w.id === lil.id).tabs[0];
}

test("automatic Lil Nap records the same capture and registry truth as a manual entry", async () => {
  const env = await boot();
  const lil = await openTitledLil(env, { url: "https://idle.example/", title: "Idle Docs" });
  await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });

  await parkIdle(env, lil, 46);
  await env.alarm();

  const tab = lilTab(env, lil);
  const entry = env.registry()[String(lil.id)];
  assert.match(tab.url, NAP_PAGE);
  assert.equal(entry.slept, true);
  assert.equal(entry.originalUrl, "https://idle.example/");
  assert.equal(entry.originalTitle, "Idle Docs");
  assert.equal(napParams(tab.url).get("t"), "Idle Docs");
  assert.equal(tab.title, "💤 Idle Docs");
  assert.ok(env.captures().has(entry.sleepCaptureKey));
  assert.deepEqual(env.sessionHistory(tab.id), [tab.url]);
});

test("automatic Lil Nap does not run when globally disabled, even after the idle threshold", async () => {
  const env = await boot();
  const lil = await openTitledLil(env, { url: "https://idle.example/", title: "Idle Docs" });
  await applySleepConfig(env, { enabled: false, afterMinutes: 45 });
  await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await parkIdle(env, lil, 46);

  await env.alarm();

  assert.equal(lilTab(env, lil).url, "https://idle.example/");
  assert.equal(env.registry()[String(lil.id)].slept, undefined);
  assert.equal(env.captures().size, 0);
});

test("automatic Lil Nap waits until the configured idle threshold has passed", async () => {
  const env = await boot();
  const lil = await openTitledLil(env, { url: "https://idle.example/", title: "Idle Docs" });
  await applySleepConfig(env, { enabled: true, afterMinutes: 45 });
  await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });

  await parkIdle(env, lil, 44);
  await env.alarm();
  assert.equal(lilTab(env, lil).url, "https://idle.example/");
  assert.equal(env.registry()[String(lil.id)].slept, undefined);

  await parkIdle(env, lil, 46);
  await env.alarm();
  assert.match(lilTab(env, lil).url, NAP_PAGE);
  assert.equal(env.registry()[String(lil.id)].slept, true);
});

test("automatic Lil Nap independently skips a focused lil", async () => {
  const env = await boot();
  const lil = await openTitledLil(env, { url: "https://idle.example/", title: "Idle Docs" });
  await applySleepConfig(env, {
    enabled: true,
    afterMinutes: 45,
    audioGuard: false,
    formGuard: false,
    whitelist: [],
  });
  await parkIdle(env, lil, 46);

  await env.alarm();

  assert.equal(lil.focused, true);
  assert.equal(lilTab(env, lil).url, "https://idle.example/");
  assert.equal(env.registry()[String(lil.id)].slept, undefined);
});

test("automatic Lil Nap independently skips an audible lil when the audio guard is on", async () => {
  const env = await boot();
  const lil = await openTitledLil(env, { url: "https://idle.example/", title: "Idle Docs" });
  await applySleepConfig(env, { enabled: true, afterMinutes: 45, audioGuard: true, formGuard: false, whitelist: [] });
  await env.setTabState(lil.tabs[0].id, { audible: true });
  await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await parkIdle(env, lil, 46);

  await env.alarm();

  assert.equal(lilTab(env, lil).url, "https://idle.example/");
  assert.equal(env.registry()[String(lil.id)].slept, undefined);
});

test("automatic Lil Nap independently skips a dirty-form lil when the form guard is on", async () => {
  const env = await boot();
  const lil = await openTitledLil(env, { url: "https://idle.example/", title: "Idle Docs" });
  await applySleepConfig(env, { enabled: true, afterMinutes: 45, audioGuard: false, formGuard: true, whitelist: [] });
  await env.message({ action: "formDirty", dirty: true }, sender(lil));
  await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await parkIdle(env, lil, 46);

  await env.alarm();

  assert.equal(lilTab(env, lil).url, "https://idle.example/");
  assert.equal(env.registry()[String(lil.id)].slept, undefined);
});

test("automatic Lil Nap independently skips a whitelisted domain", async () => {
  const env = await boot();
  const lil = await openTitledLil(env, { url: "https://mail.google.com/inbox", title: "Mail" });
  await applySleepConfig(env, {
    enabled: true,
    afterMinutes: 45,
    audioGuard: false,
    formGuard: false,
    whitelist: ["mail.google.com"],
  });
  await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await parkIdle(env, lil, 46);

  await env.alarm();

  assert.equal(lilTab(env, lil).url, "https://mail.google.com/inbox");
  assert.equal(env.registry()[String(lil.id)].slept, undefined);
});

test("automatic Lil Nap independently skips an incognito lil", async () => {
  const env = await boot();
  const lil = await openTitledLil(env, { url: "https://private.example/", title: "Secret", incognito: true });
  await applySleepConfig(env, { enabled: true, afterMinutes: 45, audioGuard: false, formGuard: false, whitelist: [] });
  await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });

  await env.alarm();

  assert.equal(env.registry()[String(lil.id)], undefined);
  assert.equal(lilTab(env, lil).url, "https://private.example/");
  assert.equal(env.captures().size, 0);
  assert.equal(journalHas(env, "tabs.captureVisibleTab"), false);
});

test("manual Let This Lil Nap still works while automatic Nap is disabled", async () => {
  const env = await boot();
  const lil = await openTitledLil(env, { url: "https://idle.example/", title: "Idle Docs" });
  await applySleepConfig(env, { enabled: false, afterMinutes: 45 });

  const reply = await env.message({ action: "sleepThisLil" }, sender(lil));

  assert.equal(reply.ok, true);
  assert.match(lilTab(env, lil).url, NAP_PAGE);
  assert.equal(env.registry()[String(lil.id)].slept, true);
  assert.equal(env.registry()[String(lil.id)].originalUrl, "https://idle.example/");
});

test("manual Let This Lil Nap ignores automatic-only guards but still refuses incognito capture", async () => {
  const env = await boot();
  const audible = await openTitledLil(env, { url: "https://audio.example/", title: "Audio" });
  await applySleepConfig(env, {
    enabled: false,
    audioGuard: true,
    formGuard: true,
    whitelist: ["audio.example"],
  });
  await env.setTabState(audible.tabs[0].id, { audible: true });
  await env.message({ action: "formDirty", dirty: true }, sender(audible));
  const audibleReply = await env.message({ action: "sleepThisLil" }, sender(audible));
  assert.equal(audibleReply.ok, true);
  assert.match(lilTab(env, audible).url, NAP_PAGE);

  const privateLil = await openTitledLil(env, { url: "https://private.example/", title: "Secret", incognito: true });
  const privateReply = await env.message({ action: "sleepThisLil" }, sender(privateLil));
  assert.equal(privateReply.ok, false);
  assert.equal(lilTab(env, privateLil).url, "https://private.example/");
});

const MANIFEST_PATH = path.resolve(path.dirname(WORKER_PATH), "manifest.json");

test("the extension registers Let This Lil Nap as an unassigned command and keeps existing shortcuts", async () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const commands = manifest.commands;
  assert.deepEqual(Object.keys(commands).sort(), ["let-this-lil-nap", "promote-tab"]);
  assert.equal(commands["let-this-lil-nap"].description, "Let This Lil Nap");
  assert.equal("suggested_key" in commands["let-this-lil-nap"], false);
  assert.deepEqual(commands["promote-tab"].suggested_key, {
    default: "Ctrl+Shift+O",
    mac: "Command+Shift+O",
  });
  const overlay = fs.readFileSync(path.resolve(path.dirname(WORKER_PATH), "overlay.js"), "utf8");
  assert.match(overlay, /e\.key === "l" \|\| e\.key === "L"/);
  assert.match(overlay, /e\.key === "o" \|\| e\.key === "O"/);
});

test("the Let This Lil Nap command naps the focused lil while automatic Nap is disabled", async () => {
  const env = await boot();
  const lil = await openTitledLil(env, { url: "https://idle.example/", title: "Idle Docs" });
  await applySleepConfig(env, { enabled: false });

  await env.command("let-this-lil-nap");

  assert.match(lilTab(env, lil).url, NAP_PAGE);
  assert.equal(env.registry()[String(lil.id)].slept, true);
  assert.equal(env.registry()[String(lil.id)].originalUrl, "https://idle.example/");
});

test("concurrent Lil Nap captures serialize within two captures per second", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver({ type: "open", url: "https://one.example/", left: 10, top: 10 });
  const one = env.windows()[0];
  await env.setTabState(one.tabs[0].id, { title: "One" });
  await env.deliver({ type: "open", url: "https://two.example/", left: 40, top: 40 });
  const two = env.windows().find((w) => w.tabs[0].url === "https://two.example/");
  await env.setTabState(two.tabs[0].id, { title: "Two" });

  await Promise.all([
    env.message({ action: "sleepThisLil" }, sender(one)),
    env.message({ action: "sleepThisLil" }, sender(two)),
  ]);

  const captures = env.journal().filter((e) => e.op === "tabs.captureVisibleTab");
  assert.equal(captures.length, 2);
  assert.ok(captures[1].at - captures[0].at >= 500, "captures stay within Chromium's two-per-second bound");
  assert.match(lilTab(env, one).url, NAP_PAGE);
  assert.match(lilTab(env, two).url, NAP_PAGE);
  assert.equal(env.captures().size, 2);
});

test("wake loads the original URL behind the nap image and swaps to the fresh document once it is ready after the 180ms floor", async () => {
  const env = await boot({ clock: true });
  const lil = await openTitledLil(env);
  const originalUrl = lil.tabs[0].url;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  const napTabId = napping.tabs[0].id;
  assert.match(napping.tabs[0].url, NAP_PAGE);
  const captureKey = env.registry()[String(lil.id)].sleepCaptureKey;
  assert.ok(env.captures().has(captureKey));

  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();

  // The load begins while the nap image remains visible: an inactive fresh
  // tab loads the original URL inside the same lil window.
  const mid = env.windows().find((w) => w.id === lil.id);
  assert.equal(mid.tabs.length, 2);
  const fresh = mid.tabs.find((t) => t.id !== napTabId);
  assert.equal(fresh.url, originalUrl);
  assert.equal(fresh.active, false);
  assert.equal(mid.tabs.find((t) => t.id === napTabId).active, true, "the nap document stays visible");

  // The fresh page signals readiness before the floor: the swap still waits.
  await env.setTabState(fresh.id, { status: "complete" });
  await env.clock.advance(179);
  await env.flush();
  const held = env.windows().find((w) => w.id === lil.id);
  assert.equal(held.tabs.length, 2, "the nap image remains for at least 180ms");
  assert.equal(held.tabs.find((t) => t.id === napTabId).active, true);
  assert.equal(env.registry()[String(lil.id)].slept, true);
  assert.ok(env.captures().has(captureKey));

  await env.clock.advance(1);
  await env.flush();

  const woken = env.windows().find((w) => w.id === lil.id);
  assert.deepEqual(
    woken.tabs.map((t) => t.id),
    [fresh.id],
    "the nap page is gone"
  );
  assert.equal(woken.tabs[0].active, true);
  assert.equal(woken.tabs[0].url, originalUrl);

  const entry = env.registry()[String(lil.id)];
  assert.ok(entry, "the lil stays registered");
  assert.equal(entry.url, originalUrl);
  assert.equal(entry.slept, undefined);
  assert.equal(entry.sleepCaptureKey, undefined);
  assert.equal(entry.originalUrl, undefined);
  assert.equal(entry.originalTitle, undefined);
  assert.equal(env.captures().has(captureKey), false, "the capture is removed");
  assert.equal((await reply).ok, true);
});

test("after the 180ms floor the wake transition completes as soon as the fresh page is ready", async () => {
  const env = await boot({ clock: true });
  const lil = await openTitledLil(env);
  const originalUrl = lil.tabs[0].url;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  const napTabId = napping.tabs[0].id;

  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();
  const fresh = env.windows().find((w) => w.id === lil.id).tabs.find((t) => t.id !== napTabId);

  // Past the floor with no readiness signal, the nap image keeps waiting.
  await env.clock.advance(250);
  await env.flush();
  assert.equal(env.windows().find((w) => w.id === lil.id).tabs.length, 2);

  // Readiness after the floor completes the transition immediately.
  await env.setTabState(fresh.id, { status: "complete" });
  await env.flush();
  const woken = env.windows().find((w) => w.id === lil.id);
  assert.deepEqual(woken.tabs.map((t) => t.id), [fresh.id]);
  assert.equal(woken.tabs[0].url, originalUrl);
  assert.equal(woken.tabs[0].active, true);
  assert.equal((await reply).ok, true);
});

test("wake swaps at the floor when the fresh page finished loading before the worker's readiness listener attached", async () => {
  const env = await boot({ clock: true });
  const lil = await openTitledLil(env);
  const originalUrl = lil.tabs[0].url;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  const napTabId = napping.tabs[0].id;

  // The fresh load completes in the gap between tabs.create resolving and the
  // worker's readiness subscription, so its onUpdated signal is never
  // observed by the waiter.
  env.chrome.tabs.onCreated.addListener((tab) => {
    if (tab.url === originalUrl) void env.setTabState(tab.id, { status: "complete" });
  });

  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();
  const fresh = env.windows().find((w) => w.id === lil.id).tabs.find((t) => t.id !== napTabId);
  assert.equal(fresh.status, "complete", "readiness already happened before the waiter listened");

  // The already-complete load still holds the image floor...
  await env.clock.advance(179);
  await env.flush();
  assert.equal(env.windows().find((w) => w.id === lil.id).tabs.length, 2);

  // ...and swaps at the floor rather than waiting out the 500ms cap.
  await env.clock.advance(1);
  await env.flush();
  const woken = env.windows().find((w) => w.id === lil.id);
  assert.deepEqual(woken.tabs.map((t) => t.id), [fresh.id]);
  assert.equal(woken.tabs[0].url, originalUrl);
  assert.equal((await reply).ok, true);
});

test("the wake transition stops waiting and swaps no later than 500ms", async () => {
  const env = await boot({ clock: true });
  const lil = await openTitledLil(env);
  const originalUrl = lil.tabs[0].url;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  const napTabId = napping.tabs[0].id;

  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();
  const fresh = env.windows().find((w) => w.id === lil.id).tabs.find((t) => t.id !== napTabId);

  // The fresh page never signals readiness: the nap image is still up at 499ms.
  await env.clock.advance(499);
  await env.flush();
  assert.equal(env.windows().find((w) => w.id === lil.id).tabs.length, 2);

  // ...and the transition proceeds at the cap, not one tick later.
  await env.clock.advance(1);
  await env.flush();
  const woken = env.windows().find((w) => w.id === lil.id);
  assert.deepEqual(woken.tabs.map((t) => t.id), [fresh.id]);
  assert.equal(woken.tabs[0].url, originalUrl);
  assert.equal(env.registry()[String(lil.id)].slept, undefined);
  assert.equal(env.captures().size, 0);
  assert.equal((await reply).ok, true);
});

test("wake produces a fresh document identity rather than resuming the released document", async () => {
  const env = await boot({ clock: true });
  const lil = await openTitledLil(env);
  const originalDocId = lil.tabs[0].documentId;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  const napDocId = napping.tabs[0].documentId;
  assert.notEqual(napDocId, originalDocId, "entry already released the original document");

  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();
  const fresh = env.windows().find((w) => w.id === lil.id).tabs.find((t) => t.id !== napping.tabs[0].id);
  await env.setTabState(fresh.id, { status: "complete" });
  await env.clock.advance(180);
  await env.flush();
  assert.equal((await reply).ok, true);

  const wokenTab = env.windows().find((w) => w.id === lil.id).tabs[0];
  assert.notEqual(wokenTab.documentId, napDocId);
  assert.notEqual(wokenTab.documentId, originalDocId, "a newly loaded document, not the released one resumed");
});

test("back/forward history holds no stale internal nap destination after wake", async () => {
  const env = await boot({ clock: true });
  const lil = await openTitledLil(env);
  const originalUrl = lil.tabs[0].url;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);

  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();
  const fresh = env.windows().find((w) => w.id === lil.id).tabs.find((t) => t.id !== napping.tabs[0].id);
  await env.setTabState(fresh.id, { status: "complete" });
  await env.clock.advance(180);
  await env.flush();
  assert.equal((await reply).ok, true);

  assert.deepEqual(env.sessionHistory(fresh.id), [originalUrl]);
  for (const win of env.windows()) {
    for (const tab of win.tabs) {
      assert.equal(
        env.sessionHistory(tab.id).some((url) => NAP_PAGE.test(url)),
        false,
        "no nap URL survives in any tab's history"
      );
    }
  }
});

test("when the wake preload is unavailable, wake holds the floor and replaces the nap document in place", async () => {
  const env = await boot({ clock: true, rejectTabCreate: () => true });
  const lil = await openTitledLil(env);
  const originalUrl = lil.tabs[0].url;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  const napTabId = napping.tabs[0].id;
  const captureKey = env.registry()[String(lil.id)].sleepCaptureKey;

  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();

  // No fresh tab could be created; the nap image is still held to the floor.
  await env.clock.advance(179);
  await env.flush();
  const held = env.windows().find((w) => w.id === lil.id);
  assert.equal(held.tabs.length, 1);
  assert.match(held.tabs[0].url, NAP_PAGE);

  await env.clock.advance(1);
  await env.flush();

  // The nap document is replaced in place: same tab, fresh document, clean history.
  const woken = env.windows().find((w) => w.id === lil.id);
  assert.equal(woken.tabs.length, 1);
  assert.equal(woken.tabs[0].id, napTabId);
  assert.equal(woken.tabs[0].url, originalUrl);
  assert.deepEqual(env.sessionHistory(napTabId), [originalUrl]);
  const entry = env.registry()[String(lil.id)];
  assert.ok(entry, "the lil stays registered");
  assert.equal(entry.url, originalUrl);
  assert.equal(entry.slept, undefined);
  assert.equal(entry.sleepCaptureKey, undefined);
  assert.equal(entry.originalUrl, undefined);
  assert.equal(entry.originalTitle, undefined);
  assert.equal(env.captures().has(captureKey), false, "the capture is removed");
  assert.equal((await reply).ok, true);
});

test("when the wake preload is returned in another window, wake keeps the lil and does not move the original URL into Primary", async () => {
  let primaryId = -1;
  let lilId = -1;
  const env = await boot({
    clock: true,
    relocateTabCreate: (opts) => (opts && opts.windowId === lilId ? primaryId : undefined),
  });
  await env.deliver(fixture("message-context"));
  const primary = await env.chrome.windows.create({ url: "https://primary.example/", type: "normal" });
  primaryId = primary.id;
  const lil = await openTitledLil(env);
  lilId = lil.id;
  const originalUrl = lil.tabs[0].url;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  const napTabId = napping.tabs[0].id;
  const captureKey = env.registry()[String(lil.id)].sleepCaptureKey;

  let returnedPreload = null;
  env.chrome.tabs.onCreated.addListener((tab) => {
    if (tab.url === originalUrl) returnedPreload = { tabId: tab.id, windowId: tab.windowId };
  });

  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();

  const createEntry = env.journal().find((e) => e.op === "tabs.create" && e.create.url === originalUrl);
  assert.equal(createEntry.create.windowId, lil.id, "requested preload window is the napping lil");
  assert.ok(returnedPreload, "a fresh tab was created");
  assert.equal(returnedPreload.windowId, primaryId, "returned fresh-tab window is Primary");

  await env.clock.advance(500);
  await env.flush();
  assert.equal((await reply).ok, true);

  const woken = env.windows().find((w) => w.id === lil.id);
  assert.ok(woken, "wake must not empty and close the lil");
  assert.equal(woken.tabs.length, 1);
  assert.equal(woken.tabs[0].id, napTabId, "the nap tab is released in place, not removed");
  assert.equal(woken.tabs[0].url, originalUrl);
  assert.equal(woken.tabs[0].active, true);
  assert.deepEqual(env.sessionHistory(napTabId), [originalUrl]);

  const primaryAfter = env.windows().find((w) => w.id === primaryId);
  assert.ok(primaryAfter, "Primary stays");
  assert.deepEqual(
    primaryAfter.tabs.map((t) => t.url),
    ["https://primary.example/"],
    "Primary receives no tab"
  );

  const entry = env.registry()[String(lil.id)];
  assert.ok(entry, "the lil stays registered");
  assert.equal(entry.url, originalUrl);
  assert.equal(entry.slept, undefined);
  assert.equal(entry.sleepCaptureKey, undefined);
  assert.equal(entry.originalUrl, undefined);
  assert.equal(entry.originalTitle, undefined);
  assert.equal(env.captures().has(captureKey), false, "the capture is removed");
});

test("a relocated wake preload that cannot replace in place leaves the lil napping and does not keep the URL in Primary", async () => {
  let primaryId = -1;
  let lilId = -1;
  let scriptingBlocked = false;
  const env = await boot({
    clock: true,
    relocateTabCreate: (opts) => (opts && opts.windowId === lilId ? primaryId : undefined),
    rejectScripting: () => scriptingBlocked,
  });
  await env.deliver(fixture("message-context"));
  const primary = await env.chrome.windows.create({ url: "https://primary.example/", type: "normal" });
  primaryId = primary.id;
  const lil = await openTitledLil(env);
  lilId = lil.id;
  const originalUrl = lil.tabs[0].url;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  const napTabId = napping.tabs[0].id;
  const captureKey = env.registry()[String(lil.id)].sleepCaptureKey;
  scriptingBlocked = true;

  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();
  await env.clock.advance(500);
  await env.flush();
  assert.equal((await reply).ok, false, "failure is reported so the nap page's own fallback can fire");

  const win = env.windows().find((w) => w.id === lil.id);
  assert.ok(win, "the lil stays open");
  assert.equal(win.tabs.length, 1);
  assert.equal(win.tabs[0].id, napTabId);
  assert.match(win.tabs[0].url, NAP_PAGE);
  const primaryAfter = env.windows().find((w) => w.id === primaryId);
  assert.deepEqual(
    primaryAfter.tabs.map((t) => t.url),
    ["https://primary.example/"],
    "the misplaced preload is dropped, not left in Primary"
  );
  const entry = env.registry()[String(lil.id)];
  assert.ok(entry, "the lil stays registered");
  assert.equal(entry.slept, true);
  assert.equal(entry.sleepCaptureKey, captureKey);
  assert.equal(entry.originalUrl, originalUrl);
  assert.equal(entry.originalTitle, ORIGINAL_PAGE_TITLE);
  assert.ok(env.captures().has(captureKey), "the capture stays referenced, not orphaned");
});

test("a relocated wake preload whose cleanup fails leaves the lil napping and does not succeed in place", async () => {
  let primaryId = -1;
  let lilId = -1;
  let napTabId = -1;
  let blockMisplacedCleanup = false;
  const env = await boot({
    clock: true,
    relocateTabCreate: (opts) => (opts && opts.windowId === lilId ? primaryId : undefined),
    rejectTabRemove: (id) => blockMisplacedCleanup && id !== napTabId,
  });
  await env.deliver(fixture("message-context"));
  const primary = await env.chrome.windows.create({ url: "https://primary.example/", type: "normal" });
  primaryId = primary.id;
  const lil = await openTitledLil(env);
  lilId = lil.id;
  const originalUrl = lil.tabs[0].url;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  napTabId = napping.tabs[0].id;
  const captureKey = env.registry()[String(lil.id)].sleepCaptureKey;
  blockMisplacedCleanup = true;

  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();
  await env.clock.advance(500);
  await env.flush();
  assert.equal((await reply).ok, false, "a leftover original-URL tab is not a completed wake");

  const win = env.windows().find((w) => w.id === lil.id);
  assert.ok(win, "the lil stays open");
  assert.equal(win.tabs.length, 1);
  assert.equal(win.tabs[0].id, napTabId);
  assert.match(win.tabs[0].url, NAP_PAGE);
  const primaryAfter = env.windows().find((w) => w.id === primaryId);
  assert.equal(
    primaryAfter.tabs.filter((t) => t.url === originalUrl).length,
    1,
    "the unresolved preload remains in Primary"
  );
  const entry = env.registry()[String(lil.id)];
  assert.ok(entry, "the lil stays registered");
  assert.equal(entry.slept, true);
  assert.equal(entry.sleepCaptureKey, captureKey);
  assert.equal(entry.originalUrl, originalUrl);
  assert.equal(entry.originalTitle, ORIGINAL_PAGE_TITLE);
  assert.ok(env.captures().has(captureKey), "the capture stays referenced, not orphaned");
});

test("when wake cannot navigate at all, it reports failure and leaves nap state truthful", async () => {
  let scriptingBlocked = false;
  const env = await boot({
    clock: true,
    rejectTabCreate: () => true,
    rejectScripting: () => scriptingBlocked,
  });
  const lil = await openTitledLil(env);
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  const napTabId = napping.tabs[0].id;
  const captureKey = env.registry()[String(lil.id)].sleepCaptureKey;
  assert.ok(env.captures().has(captureKey));

  // The worker can reach the window but cannot produce any fresh navigation.
  scriptingBlocked = true;
  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();
  await env.clock.advance(500);
  await env.flush();
  assert.equal((await reply).ok, false, "failure is reported so the nap page's own fallback can fire");

  // Nothing is stranded or leaked: the nap page, its registry truth, and the
  // capture are exactly as they were before the failed wake.
  const tab = env.windows().find((w) => w.id === lil.id).tabs[0];
  assert.equal(tab.id, napTabId);
  assert.match(tab.url, NAP_PAGE);
  const entry = env.registry()[String(lil.id)];
  assert.ok(entry, "the lil stays registered");
  assert.equal(entry.slept, true);
  assert.equal(entry.sleepCaptureKey, captureKey);
  assert.equal(entry.originalUrl, "https://example.com/docs");
  assert.equal(entry.originalTitle, ORIGINAL_PAGE_TITLE);
  assert.ok(env.captures().has(captureKey), "the capture stays referenced, not orphaned");
});

test("when wake cannot activate the fresh document, it reports failure and leaves the nap exactly as it was", async () => {
  const env = await boot({
    clock: true,
    rejectTabUpdate: (id, opts) => !!(opts && opts.active === true),
  });
  const lil = await openTitledLil(env);
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  const napTabId = napping.tabs[0].id;
  const captureKey = env.registry()[String(lil.id)].sleepCaptureKey;

  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();
  const fresh = env.windows().find((w) => w.id === lil.id).tabs.find((t) => t.id !== napTabId);
  await env.setTabState(fresh.id, { status: "complete" });
  await env.clock.advance(180);
  await env.flush();
  assert.equal((await reply).ok, false, "an inactive preload is not a completed wake");

  // The failed preload is gone and the nap document is still the visible,
  // active tab: visible state, registry truth, and capture all agree.
  const win = env.windows().find((w) => w.id === lil.id);
  assert.deepEqual(win.tabs.map((t) => t.id), [napTabId]);
  assert.equal(win.tabs[0].active, true);
  assert.match(win.tabs[0].url, NAP_PAGE);
  const entry = env.registry()[String(lil.id)];
  assert.ok(entry, "the lil stays registered");
  assert.equal(entry.slept, true);
  assert.equal(entry.sleepCaptureKey, captureKey);
  assert.equal(entry.originalUrl, "https://example.com/docs");
  assert.equal(entry.originalTitle, ORIGINAL_PAGE_TITLE);
  assert.ok(env.captures().has(captureKey), "the capture stays referenced, not orphaned");
});

test("when the nap tab cannot be removed, wake puts it back in front, reports failure, and keeps nap state", async () => {
  let napTabId = -1;
  const env = await boot({
    clock: true,
    rejectTabRemove: (id) => id === napTabId,
  });
  const lil = await openTitledLil(env);
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  napTabId = napping.tabs[0].id;
  const captureKey = env.registry()[String(lil.id)].sleepCaptureKey;

  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();
  const fresh = env.windows().find((w) => w.id === lil.id).tabs.find((t) => t.id !== napTabId);
  await env.setTabState(fresh.id, { status: "complete" });
  await env.clock.advance(180);
  await env.flush();
  assert.equal((await reply).ok, false, "the nap document was never replaced");

  // Rolled back to the exact pre-wake truth: the nap document is the visible
  // active tab, the preload is gone, and nap registry fields + capture stay.
  const win = env.windows().find((w) => w.id === lil.id);
  assert.deepEqual(win.tabs.map((t) => t.id), [napTabId]);
  assert.equal(win.tabs[0].active, true, "the nap document is back in front");
  assert.match(win.tabs[0].url, NAP_PAGE);
  const entry = env.registry()[String(lil.id)];
  assert.ok(entry, "the lil stays registered");
  assert.equal(entry.slept, true);
  assert.equal(entry.sleepCaptureKey, captureKey);
  assert.equal(entry.originalUrl, "https://example.com/docs");
  assert.equal(entry.originalTitle, ORIGINAL_PAGE_TITLE);
  assert.ok(env.captures().has(captureKey), "the capture stays referenced, not orphaned");
});

test("when a napping lil leaves the nap document without a worker wake, leftover nap state is still reconciled", async () => {
  const env = await boot();
  const lil = await openTitledLil(env);
  const originalUrl = lil.tabs[0].url;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  const captureKey = env.registry()[String(lil.id)].sleepCaptureKey;
  assert.match(napping.tabs[0].url, NAP_PAGE);
  assert.ok(env.captures().has(captureKey));

  // The page's own fallback replaced the nap document; cleanup APIs may still
  // be outstanding. The worker sees the URL leave sleep.html.
  await env.chrome.tabs.update(napping.tabs[0].id, { url: originalUrl });
  await env.flush();

  const entry = env.registry()[String(lil.id)];
  assert.ok(entry, "the lil stays registered");
  assert.equal(entry.url, originalUrl);
  assert.equal(entry.slept, undefined);
  assert.equal(entry.sleepCaptureKey, undefined);
  assert.equal(entry.originalUrl, undefined);
  assert.equal(entry.originalTitle, undefined);
  assert.equal(env.captures().has(captureKey), false, "the capture is not left behind");
});

test("when an inactive same-window wake preload reports its original URL, nap state stays truthful", async () => {
  const env = await boot();
  const lil = await openTitledLil(env);
  const originalUrl = lil.tabs[0].url;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  const napTabId = napping.tabs[0].id;
  const captureKey = env.registry()[String(lil.id)].sleepCaptureKey;
  assert.match(napping.tabs[0].url, NAP_PAGE);
  assert.ok(env.captures().has(captureKey));

  // Same create wakeLil uses. Chromium then reports the preload URL through
  // tabs.onUpdated while the nap document is still the visible tab; the fake's
  // tabs.create does not emit that URL event, so drive it the same way the
  // leftover-nap backstop test does.
  const preload = await env.chrome.tabs.create({
    windowId: lil.id,
    url: originalUrl,
    active: false,
  });
  await env.chrome.tabs.update(preload.id, { url: originalUrl });
  await env.flush();

  const win = env.windows().find((w) => w.id === lil.id);
  const stillNap = win.tabs.find((t) => t.id === napTabId);
  assert.equal(stillNap.active, true, "the nap document stays in front");
  assert.match(stillNap.url, NAP_PAGE);
  const entry = env.registry()[String(lil.id)];
  assert.ok(entry, "the lil stays registered");
  assert.equal(entry.slept, true);
  assert.equal(entry.sleepCaptureKey, captureKey);
  assert.equal(entry.originalUrl, originalUrl);
  assert.equal(entry.originalTitle, ORIGINAL_PAGE_TITLE);
  assert.ok(env.captures().has(captureKey), "the capture stays referenced, not orphaned");
});

test("a redirect on the fresh document mid-swap cannot clear nap state before the nap tab is gone", async () => {
  const REDIRECTED_URL = "https://example.com/docs?ref=redirect";
  let napTabId = null;
  let freshTabId = null;
  const env = await boot({
    clock: true,
    // The nap tab refuses to close at the one moment the fresh document is
    // already active — and the fresh page finishes a redirect right then, so
    // the leftover-nap backstop sees an active tab off the nap URL while the
    // swap is still reversible.
    rejectTabRemove: (id) => {
      if (id !== napTabId) return false;
      void env.chrome.tabs.update(freshTabId, { url: REDIRECTED_URL });
      return true;
    },
  });
  const lil = await openTitledLil(env);
  const originalUrl = lil.tabs[0].url;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  napTabId = napping.tabs[0].id;
  const captureKey = env.registry()[String(lil.id)].sleepCaptureKey;

  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();
  freshTabId = env.windows().find((w) => w.id === lil.id).tabs.find((t) => t.id !== napTabId).id;
  await env.setTabState(freshTabId, { status: "complete" });
  await env.clock.advance(180);
  await env.flush();

  assert.equal((await reply).ok, false, "the nap document was never replaced, so wake failed");

  // The nap document is back in front, alone, and every nap fact still holds.
  const win = env.windows().find((w) => w.id === lil.id);
  assert.deepEqual(win.tabs.map((t) => t.id), [napTabId], "the preload is dropped");
  assert.equal(win.tabs[0].active, true);
  assert.match(win.tabs[0].url, NAP_PAGE);
  const entry = env.registry()[String(lil.id)];
  assert.ok(entry, "the lil stays registered");
  assert.equal(entry.slept, true);
  assert.equal(entry.sleepCaptureKey, captureKey);
  assert.equal(entry.originalUrl, originalUrl);
  assert.equal(entry.originalTitle, ORIGINAL_PAGE_TITLE);
  assert.ok(env.captures().has(captureKey), "the capture stays referenced, not orphaned");
});

test("a mid-swap redirect handled only after the rollback still cannot clear nap state", async () => {
  const REDIRECTED_URL = "https://example.com/docs?ref=redirect";
  let napTabId = null;
  const env = await boot({ clock: true, rejectTabRemove: (id) => id === napTabId });
  const lil = await openTitledLil(env);
  const originalUrl = lil.tabs[0].url;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  napTabId = napping.tabs[0].id;
  const captureKey = env.registry()[String(lil.id)].sleepCaptureKey;

  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();
  const freshTabId = env.windows().find((w) => w.id === lil.id).tabs.find((t) => t.id !== napTabId).id;
  await env.setTabState(freshTabId, { status: "complete" });
  await env.clock.advance(180);
  await env.flush();
  assert.equal((await reply).ok, false, "removal failed, so the swap rolled back");

  // Chrome queued this redirect while the fresh document was active and the
  // swap was still reversible, but the worker only reaches the listener now —
  // after the rollback. Anything the swap sampled about itself is already gone,
  // so the decision has to rest on what is true of the window right now.
  await env.chrome.tabs.onUpdated.fire(
    freshTabId,
    { url: REDIRECTED_URL },
    { id: freshTabId, windowId: lil.id, active: true, url: REDIRECTED_URL }
  );
  await env.flush();

  const entry = env.registry()[String(lil.id)];
  assert.ok(entry, "the lil stays registered");
  assert.equal(entry.slept, true, "the nap document is still in front, so nap state is not leftover");
  assert.equal(entry.sleepCaptureKey, captureKey);
  assert.equal(entry.originalUrl, originalUrl);
  assert.equal(entry.originalTitle, ORIGINAL_PAGE_TITLE);
  assert.ok(env.captures().has(captureKey), "the capture stays referenced, not orphaned");
});

test("when the worker cannot tell whether a nap document remains, nap state stays truthful", async () => {
  // Only the leftover check asks for a window's tabs without an active filter.
  const env = await boot({ rejectTabQuery: (q) => q.windowId !== undefined && q.active === undefined });
  const lil = await openTitledLil(env);
  const originalUrl = lil.tabs[0].url;
  await env.message({ action: "sleepThisLil" }, sender(lil));
  const napping = env.windows().find((w) => w.id === lil.id);
  const captureKey = env.registry()[String(lil.id)].sleepCaptureKey;
  assert.ok(env.captures().has(captureKey));

  // The visible document left the nap URL, but the worker cannot find out
  // whether a nap document is still around. Clearing would be a guess, and a
  // wrong guess destroys the capture the nap still needs.
  await env.chrome.tabs.update(napping.tabs[0].id, { url: originalUrl });
  await env.flush();

  const entry = env.registry()[String(lil.id)];
  assert.ok(entry, "the lil stays registered");
  assert.equal(entry.slept, true, "uncertainty leaves the nap truth alone");
  assert.equal(entry.sleepCaptureKey, captureKey);
  assert.equal(entry.originalUrl, originalUrl);
  assert.ok(env.captures().has(captureKey), "the capture is not deleted on a guess");
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

// ---------------------------------------------------------------------------
// Hot-apply (issue #12). A native Settings write reaches this worker as a
// config-update forwarded by the host; the worker replaces the config half of
// its cached context (its own browser identity is not the app's to change)
// and pushes the result to every live lil's overlay.
// ---------------------------------------------------------------------------

test("config-update replaces the cached config but keeps the host identity", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(fixture("message-config-update"));

  const { context } = await env.message({ action: "getContext" });
  assert.equal(context.primaryBrowser, "vivaldi");
  assert.equal(context.primaryBrowserName, "Vivaldi");
  assert.equal(context.fallbackBrowser, "chrome");
  assert.equal(context.linkBehavior, "same-lil");
  assert.equal(context.ephemeralDefault, 12, "normalized from the wire's 12h");
  assert.equal(context.sleep.afterMinutes, 60);
  assert.equal(context.sleep.audioGuard, false);
  assert.deepEqual(context.sleep.whitelist, ["example.com", "mail.google.com"]);
  assert.equal(context.searchEngine.name, "Bing");
  assert.equal(context.hoverBar.style, "glass");
  assert.equal(context.hoverBar.tint, "#4455ff");
  assert.equal(context.hoverBar.revealHeight, 8);
  assert.deepEqual(
    context.knownBrowsers.map((b) => b.slug),
    ["vivaldi", "chrome"]
  );
  // Host identity belongs to this worker's host, not to the app's config.
  assert.equal(context.browser, "brave");
  assert.equal(context.browserName, "Brave");
});

test("a config update is pushed to every live lil, including incognito ones", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver({ type: "open", url: "https://a.example/", left: 10, top: 10 });
  await env.deliver({ type: "open", url: "https://b.example/", left: 20, top: 20 });
  await env.deliver({ type: "open", url: "https://c.example/", incognito: true, left: 30, top: 30 });
  const lils = env.windows().filter((w) => w.type === "popup");
  assert.equal(lils.length, 3);

  await env.deliver(fixture("message-config-update"));

  for (const lil of lils) {
    const pushes = env.journal().filter(
      (e) => e.op === "tabs.sendMessage" && e.tabId === lil.tabs[0].id && e.message.action === "contextUpdate"
    );
    assert.equal(pushes.length, 1, `lil ${lil.id} received exactly one context push`);
    const pushed = pushes[0].message.context;
    assert.equal(pushed.hoverBar.tint, "#4455ff");
    assert.equal(pushed.hoverBar.revealHeight, 8);
    assert.equal(pushed.primaryBrowser, "vivaldi");
    assert.equal(
      JSON.stringify(pushed).includes("bundleId"),
      false,
      "lil-facing context never carries bundle ids"
    );
  }
});

test("future lils seed from the new config without overwriting per-lil overrides", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context")); // ephemeralDefault "6h"
  await env.deliver({ type: "open", url: "https://a.example/", left: 10, top: 10 });
  const first = env.windows()[0];
  assert.equal(env.registry()[String(first.id)].expiry, 6);

  // The hover bar's Keep menu sets a per-lil override.
  await env.message({ action: "setExpiry", expiry: "never" }, sender(first));

  await env.deliver(fixture("message-config-update")); // ephemeralDefault "12h"
  await env.deliver({ type: "open", url: "https://b.example/", left: 20, top: 20 });
  const second = env.windows().find((w) => w.id !== first.id);

  assert.equal(
    env.registry()[String(first.id)].expiry,
    "never",
    "the per-lil override survives the broadcast"
  );
  assert.equal(env.registry()[String(second.id)].expiry, 12, "the new lil seeds from the new default");
});

test("a relay that missed the broadcast catches up from the file on reconnect", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(fixture("message-open-legacy"));
  const lil = env.windows()[0];
  const tabId = lil.tabs[0].id;
  const asksBefore = env.outgoing().filter((m) => m.type === "get-context").length;

  // The relay goes down (the app's config-update never reached it) and the
  // worker reconnects: it must ask the host for fresh context again.
  await env.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 400)); // reconnect backoff starts at 250ms
  await env.flush();
  const asksAfter = env.outgoing().filter((m) => m.type === "get-context").length;
  assert.ok(asksAfter > asksBefore, "the reconnecting worker asks for fresh context");

  // The host's reply comes from a fresh read of the config.json the app wrote
  // while this relay was down (same payload the broadcast would have carried).
  await env.deliver({ ...fixture("message-config-update"), type: "context", id: "ctx-reconnect" });

  const { context } = await env.message({ action: "getContext" });
  assert.equal(context.primaryBrowser, "vivaldi");
  assert.equal(context.hoverBar.revealHeight, 8);
  const pushes = env.journal().filter(
    (e) => e.op === "tabs.sendMessage" && e.tabId === tabId && e.message.action === "contextUpdate"
  );
  assert.equal(pushes.length, 1, "the live lil converges after the catch-up");
  assert.equal(pushes[0].message.context.hoverBar.tint, "#4455ff");
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
// New-window link classification (issue #16). The configured New-window Links
// behavior applies to every genuine requested browsing target — including
// opener-less (`rel="noopener"`) spawns — while native popup windows and
// guarded authentication flows stay native.
// ---------------------------------------------------------------------------

test("an opener-less requested target follows the configured new-lil behavior", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");

  // Chromium raises the spawn's normal window before the navigation claim.
  await env.chrome.windows.update(normal.id, { focused: true });
  // A rel="noopener" target=_blank: a genuine requested target with no opener.
  const spawned = await env.chrome.tabs.create({
    windowId: normal.id,
    url: "https://noopener.example/",
    active: true,
  });
  await env.createdNavigationTarget({
    tabId: spawned.id,
    sourceTabId: source.tabs[0].id,
    url: "https://noopener.example/",
  });

  const cascaded = env.windows().find((w) => w.type === "popup" && w.id !== source.id);
  assert.ok(cascaded, "a missing opener alone must not preserve a normal-window spawn");
  assert.equal(cascaded.focused, true);
  assert.equal(cascaded.tabs[0].id, spawned.id);
  assert.equal(
    env.journal().filter((e) => e.op === "windows.create" && e.create.tabId === spawned.id).length,
    1,
    "exactly one flow re-parents the spawn"
  );
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(cascaded.id)].priorContext)), {
    kind: "lil",
    windowId: source.id,
  });
  assert.equal(
    env.windows().find((w) => w.id === source.id).tabs[0].url,
    "https://lil.example/",
    "the source lil is not navigated"
  );
  assert.equal(
    env.windows().find((w) => w.id === normal.id).tabs.some((t) => t.id === spawned.id),
    false,
    "the spawn left the normal window"
  );
});

test("a native popup window keeps its window and opener when it hosts a link target", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");

  // Featureful window.open: Chromium gives the flow its own popup window.
  const popup = await env.chrome.windows.create({
    url: "https://popup.example/",
    type: "popup",
    openerTabId: source.tabs[0].id,
  });
  const before = env.journal().length;

  await env.createdNavigationTarget({
    tabId: popup.tabs[0].id,
    sourceTabId: source.tabs[0].id,
    url: "https://popup.example/",
  });

  const after = env.journal().slice(before);
  assert.equal(after.some((e) => e.op === "windows.create"), false, "no re-parent");
  assert.equal(after.some((e) => e.op === "tabs.update"), false, "no navigation");
  assert.equal(after.some((e) => e.op === "tabs.remove"), false, "nothing removed");
  const popupNow = env.windows().find((w) => w.id === popup.id);
  assert.ok(popupNow, "the native popup window stays");
  assert.equal(popupNow.tabs[0].openerTabId, source.tabs[0].id, "the opener relationship survives intact");
  assert.equal(env.registry()[String(popup.id)], undefined, "no registry entry");
  assert.deepEqual(Object.keys(env.registry()), [String(source.id)]);
});

test("a popup window without an opener is still preserved as a native popup", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");

  // The popup window type alone preserves the flow; no opener is required.
  const popup = await env.chrome.windows.create({ url: "https://popup.example/", type: "popup" });
  const before = env.journal().length;

  await env.createdNavigationTarget({
    tabId: popup.tabs[0].id,
    sourceTabId: source.tabs[0].id,
    url: "https://popup.example/",
  });

  const after = env.journal().slice(before);
  assert.equal(after.some((e) => e.op === "windows.create"), false);
  assert.equal(after.some((e) => e.op === "tabs.update"), false);
  assert.equal(after.some((e) => e.op === "tabs.remove"), false);
  assert.ok(env.windows().find((w) => w.id === popup.id));
  assert.deepEqual(Object.keys(env.registry()), [String(source.id)]);
});

test("a guarded auth target in a normal window keeps its native tab and opener", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");

  const spawned = await env.chrome.tabs.create({
    windowId: normal.id,
    url: "https://accounts.google.com/o/oauth2/auth?client_id=example",
    openerTabId: source.tabs[0].id,
    active: true,
  });
  const before = env.journal().length;

  await env.createdNavigationTarget({
    tabId: spawned.id,
    sourceTabId: source.tabs[0].id,
    url: "https://accounts.google.com/o/oauth2/auth?client_id=example",
  });

  const after = env.journal().slice(before);
  assert.equal(after.some((e) => e.op === "windows.create"), false, "an auth flow is never re-parented");
  assert.equal(after.some((e) => e.op === "tabs.update"), false, "the source lil is not navigated");
  assert.equal(after.some((e) => e.op === "tabs.remove"), false, "the auth tab is never closed");
  const spawnedNow = env.windows().find((w) => w.id === normal.id).tabs.find((t) => t.id === spawned.id);
  assert.ok(spawnedNow, "the auth tab keeps its native window");
  assert.equal(spawnedNow.openerTabId, source.tabs[0].id, "the auth tab keeps its opener");
  assert.deepEqual(Object.keys(env.registry()), [String(source.id)]);
});

test("a guarded auth host-suffix target is preserved", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");

  const spawned = await env.chrome.tabs.create({
    windowId: normal.id,
    url: "https://lil-chromium.auth0.com/authorize?client_id=example",
    openerTabId: source.tabs[0].id,
    active: true,
  });

  await env.createdNavigationTarget({
    tabId: spawned.id,
    sourceTabId: source.tabs[0].id,
    url: "https://lil-chromium.auth0.com/authorize?client_id=example",
  });

  assert.equal(
    journalHas(env, "windows.create", (e) => e.create.tabId === spawned.id),
    false,
    "an auth0-hosted flow is never re-parented"
  );
  assert.ok(env.windows().find((w) => w.id === normal.id).tabs.some((t) => t.id === spawned.id));
  assert.equal(env.windows().find((w) => w.id === source.id).tabs[0].url, "https://lil.example/");
  assert.deepEqual(Object.keys(env.registry()), [String(source.id)]);
});

test("an ordinary same-target link navigates the current lil without creating another window", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const lil = env.windows()[0];
  const before = env.journal().length;

  // An ordinary in-place navigation raises no navigation-target event.
  await env.chrome.tabs.update(lil.tabs[0].id, { url: "https://lil.example/next" });
  await env.flush();

  const after = env.journal().slice(before);
  assert.equal(after.some((e) => e.op === "windows.create"), false, "no new window");
  assert.equal(after.some((e) => e.op === "tabs.remove"), false, "no tab removed");
  assert.equal(env.windows().length, 1);
  assert.equal(env.windows()[0].id, lil.id);
  assert.equal(env.windows()[0].tabs[0].url, "https://lil.example/next");
  assert.equal(
    env.registry()[String(lil.id)].url,
    "https://lil.example/next",
    "the registry follows the in-place navigation"
  );
});

test("same-lil handling navigates the source, removes the spawned target, and restores focus", async () => {
  const env = await boot();
  await env.deliver({ ...fixture("message-context"), linkBehavior: "same-lil" });
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");
  const spawned = await env.chrome.tabs.create({
    windowId: normal.id,
    url: "https://spawned.example/",
    openerTabId: source.tabs[0].id,
    active: true,
  });
  // The spawn raised its normal host window.
  await env.chrome.windows.update(normal.id, { focused: true });
  await env.flush();
  const before = env.journal().length;

  await env.createdNavigationTarget({
    tabId: spawned.id,
    sourceTabId: source.tabs[0].id,
    url: "https://spawned.example/",
  });

  const sourceNow = env.windows().find((w) => w.id === source.id);
  assert.equal(sourceNow.tabs[0].url, "https://spawned.example/", "the source lil navigates");
  await assert.rejects(() => env.chrome.tabs.get(spawned.id), /No tab with id/, "the spawned target is removed");
  assert.equal(env.windows().filter((w) => w.type === "popup").length, 1, "no new window is created");
  assert.equal(sourceNow.focused, true, "focus is explicitly restored to the source lil");

  const after = env.journal().slice(before);
  const navigated = after.findIndex(
    (e) => e.op === "tabs.update" && e.tabId === source.tabs[0].id && e.update.url === "https://spawned.example/"
  );
  const removed = after.findIndex((e) => e.op === "tabs.remove" && e.tabId === spawned.id);
  const refocused = after.findIndex(
    (e) => e.op === "windows.update" && e.windowId === source.id && e.update.focused === true
  );
  assert.ok(navigated >= 0 && removed > navigated && refocused > removed, "navigate → remove → refocus, in that order");
  assert.equal(after.some((e) => e.op === "windows.create"), false);
  assert.deepEqual(Object.keys(env.registry()), [String(source.id)]);
});

test("a requested target follows the live hot-applied linkBehavior", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context")); // new-lil
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");

  // A native Settings write flips the behavior without any reload (issue #12).
  await env.deliver(fixture("message-config-update")); // same-lil
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

  const sourceNow = env.windows().find((w) => w.id === source.id);
  assert.equal(sourceNow.tabs[0].url, "https://spawned.example/", "same-lil applies from the live config");
  await assert.rejects(() => env.chrome.tabs.get(spawned.id), /No tab with id/);
  assert.equal(env.windows().filter((w) => w.type === "popup").length, 1);
});

test("a Command-click flips the configured new-lil behavior for that target only", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context")); // new-lil
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");

  await env.message({ action: "clickHint", url: "https://spawned.example/", meta: true, ts: Date.now() });
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

  const sourceNow = env.windows().find((w) => w.id === source.id);
  assert.equal(sourceNow.tabs[0].url, "https://spawned.example/", "⌘-click collapses into the source lil");
  await assert.rejects(() => env.chrome.tabs.get(spawned.id), /No tab with id/);
  assert.equal(env.windows().filter((w) => w.type === "popup").length, 1);

  // The hint was consumed: the same target without a new hint follows the config.
  const again = await env.chrome.tabs.create({
    windowId: normal.id,
    url: "https://spawned.example/",
    openerTabId: source.tabs[0].id,
    active: true,
  });
  await env.createdNavigationTarget({
    tabId: again.id,
    sourceTabId: source.tabs[0].id,
    url: "https://spawned.example/",
  });
  const cascaded = env.windows().find((w) => w.type === "popup" && w.id !== source.id);
  assert.ok(cascaded, "the next spawn without a hint follows the configured new-lil behavior");
  assert.equal(cascaded.tabs[0].id, again.id);
});

test("a Command-click flips the configured same-lil behavior for that target only", async () => {
  const env = await boot();
  await env.deliver({ ...fixture("message-context"), linkBehavior: "same-lil" });
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");

  await env.message({ action: "clickHint", url: "https://spawned.example/", meta: true, ts: Date.now() });
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

  const cascaded = env.windows().find((w) => w.type === "popup" && w.id !== source.id);
  assert.ok(cascaded, "⌘-click cascades into a new lil despite same-lil config");
  assert.equal(cascaded.tabs[0].id, spawned.id);
  assert.equal(
    env.windows().find((w) => w.id === source.id).tabs[0].url,
    "https://lil.example/",
    "the source lil is not navigated"
  );
});

test("classification waits for the spawned tab to settle and reads its final navigation state", async () => {
  const env = await boot({ settleMisses: { "https://redirector.example/": 1 } });
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");
  const spawned = await env.chrome.tabs.create({
    windowId: normal.id,
    url: "https://redirector.example/",
    openerTabId: source.tabs[0].id,
    active: true,
  });

  // The target redirects onto a guarded auth URL while the worker settles.
  const fired = env.createdNavigationTarget({
    tabId: spawned.id,
    sourceTabId: source.tabs[0].id,
    url: "https://redirector.example/",
  });
  await env.chrome.tabs.update(spawned.id, {
    url: "https://accounts.google.com/o/oauth2/auth?client_id=example",
  });
  await fired;

  assert.equal(
    journalHas(env, "windows.create", (e) => e.create.tabId === spawned.id),
    false,
    "a guarded final URL is preserved even though the requested URL was innocent"
  );
  assert.ok(env.windows().find((w) => w.id === normal.id).tabs.some((t) => t.id === spawned.id));
  assert.equal(env.windows().find((w) => w.id === source.id).tabs[0].url, "https://lil.example/");
  assert.deepEqual(Object.keys(env.registry()), [String(source.id)]);
});

test("a spawned tab that settles late is still classified and cascaded", async () => {
  const env = await boot({ settleMisses: { "https://spawned.example/": 2 } });
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");
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

  const cascaded = env.windows().find((w) => w.type === "popup" && w.id !== source.id);
  assert.ok(cascaded, "the settle wait still reaches the configured behavior");
  assert.equal(cascaded.tabs[0].id, spawned.id);
  assert.ok(env.registry()[String(cascaded.id)]);
});

test("a spawned tab that never settles is left untouched", async () => {
  const env = await boot({ settleMisses: { "https://ghost.example/": 99 } });
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");
  const spawned = await env.chrome.tabs.create({
    windowId: normal.id,
    url: "https://ghost.example/",
    openerTabId: source.tabs[0].id,
    active: true,
  });
  const before = env.journal().length;

  await env.createdNavigationTarget({
    tabId: spawned.id,
    sourceTabId: source.tabs[0].id,
    url: "https://ghost.example/",
  });

  const after = env.journal().slice(before);
  assert.equal(after.some((e) => e.op === "windows.create"), false, "no classification without settled state");
  assert.equal(after.some((e) => e.op === "tabs.update"), false);
  assert.equal(after.some((e) => e.op === "tabs.remove"), false);
  assert.ok(env.windows().find((w) => w.id === normal.id).tabs.some((t) => t.id === spawned.id));
  assert.equal(env.windows().find((w) => w.id === source.id).tabs[0].url, "https://lil.example/");
  assert.deepEqual(Object.keys(env.registry()), [String(source.id)]);
});

test("new-lil handling focuses only the new lil and never raises the host window", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");
  const spawned = await env.chrome.tabs.create({
    windowId: normal.id,
    url: "https://spawned.example/",
    openerTabId: source.tabs[0].id,
    active: true,
  });
  // Chromium raises the spawn's normal host window for the active new tab.
  await env.chrome.windows.update(normal.id, { focused: true });
  await env.flush();
  const before = env.journal().length;

  await env.createdNavigationTarget({
    tabId: spawned.id,
    sourceTabId: source.tabs[0].id,
    url: "https://spawned.example/",
  });

  const cascaded = env.windows().find((w) => w.type === "popup" && w.id !== source.id);
  assert.ok(cascaded);
  assert.equal(cascaded.focused, true, "only the new lil ends focused");
  assert.equal(env.windows().find((w) => w.id === normal.id).focused, false);
  const after = env.journal().slice(before);
  assert.equal(
    after.some((e) => e.op === "windows.update" && e.windowId === normal.id && e.update.focused === true),
    false,
    "the incidental host window is never raised"
  );
  assert.equal(
    after.some((e) => e.op === "windows.update" && e.windowId === source.id && e.update.focused === true),
    false,
    "the source lil is not re-raised either"
  );
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(cascaded.id)].priorContext)), {
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

test("restart restoration remaps a nested lil chain, which yields to live focus history", async () => {
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

  // ADR-0004: the user's first focus of the restored child comes from outside
  // the browser, so closing it returns there; the parked chain is not replayed
  // and the host learns the external app from its own activation history.
  await env.chrome.windows.update(child.id, { focused: true });
  await env.chrome.windows.remove(child.id);
  await env.flush();
  assert.equal(env.windows().find((win) => win.id === root.id).focused, false);
  assert.deepEqual(env.outgoing().at(-1), fixture("message-restore-focus-live"));
});

test("a worker that wakes with a normal window focused reads it as the context the user came from", async () => {
  const parked = {
    41: {
      url: "https://parked.example/",
      bounds: { left: 100, top: 100, width: 900, height: 700 },
      expiry: "never",
      lastInteraction: 1,
      priorContext: { kind: "external-app", pid: 4242, bundleId: "com.apple.mail" },
    },
  };
  const env = await boot({
    windows: [{ type: "normal", url: "https://primary.example/", focused: true }],
    storage: { ephemeralWindows: parked },
  });
  await env.startup();
  const primary = env.windows().find((win) => win.type === "normal");
  const lil = env.windows().find((win) => win.tabs[0].url === "https://parked.example/");

  await env.chrome.windows.update(lil.id, { focused: true });
  await env.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(lil.id)].priorContext)), {
    kind: "normal-window",
    windowId: primary.id,
  });

  await env.chrome.windows.remove(lil.id);
  await env.flush();
  assert.equal(env.windows().find((win) => win.id === primary.id).focused, true);
  assert.ok(!env.outgoing().some((msg) => msg.type === "restore-focus"));
});

test("a worker that wakes with a normal window focused still converts a Command+T tab opened there from a lil", async () => {
  const env = await boot({ windows: [{ type: "normal", url: "https://host.example/", focused: true }] });
  await env.deliver(fixture("message-context"));
  const normal = env.windows().find((w) => w.type === "normal");
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");
  assert.equal(source.focused, true);

  const created = await env.chrome.tabs.create({ windowId: normal.id, active: true, url: "chrome://newtab/" });
  await env.flush();

  const converted = env.windows().find((w) => w.type === "popup" && w.id !== source.id);
  assert.ok(converted, "the browser-created tab was adopted into a new lil");
  assert.equal(converted.tabs[0].id, created.id);
});

test("closing an unfocused lil by its red button while a sibling lil holds focus restores nothing, even after a wake", async () => {
  const env = await boot({ clock: true });
  const first = await openTitledLil(env);
  await env.message({ action: "sleepThisLil" }, sender(first));
  const napping = env.windows().find((w) => w.id === first.id);
  const reply = env.messageLater({ action: "wakeLil" }, sender(napping));
  await env.flush();
  const fresh = env.windows().find((w) => w.id === first.id).tabs.find((t) => t.id !== napping.tabs[0].id);
  await env.clock.advance(180);
  await env.setTabState(fresh.id, { status: "complete" });
  assert.equal((await reply).ok, true, "the focused lil woke in place");
  assert.deepEqual(env.windows().find((w) => w.id === first.id).tabs.map((t) => t.id), [fresh.id]);

  await env.deliver({ type: "open", url: "https://second.example/", left: 10, top: 10 });
  const second = env.windows().find((w) => w.type === "popup" && w.id !== first.id);
  assert.equal(second.focused, true);
  const requestsBefore = env.outgoing().filter((m) => m.type === "restore-focus").length;

  await env.chrome.windows.remove(first.id);
  await env.flush();

  assert.equal(env.windows().find((w) => w.id === second.id).focused, true, "the active lil is left alone");
  assert.equal(env.outgoing().filter((m) => m.type === "restore-focus").length, requestsBefore);
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

test("opening Settings from a lil posts open-settings and does not raise a browser window", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  await env.deliver(fixture("message-open-legacy"));
  const lil = env.windows()[0];
  const host = await env.chrome.windows.create({ url: "https://mail.example/", type: "normal" });
  await env.chrome.windows.update(host.id, { focused: true });
  const beforeJournal = env.journal().length;
  const beforeOutgoing = env.outgoing().length;

  const reply = await env.message({ action: "openSettings" }, sender(lil));

  assert.equal(reply.ok, true);
  const posted = env.outgoing().slice(beforeOutgoing).filter((m) => m.type === "open-settings");
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0], fixture("message-open-settings"));
  assert.equal(
    env.outgoing().slice(beforeOutgoing).some((m) => m.type === "open-external"),
    false
  );

  const after = env.journal().slice(beforeJournal);
  assert.equal(
    after.some((e) => e.op === "windows.create"),
    false,
    "Settings must not create a window"
  );
  assert.equal(
    after.some((e) => e.op === "windows.update" && e.update && e.update.focused === true),
    false,
    "Settings must not explicitly focus a Host-browser window"
  );
  assert.equal(env.windows().find((w) => w.id === host.id).focused, true);
  assert.equal(env.windows().length, 2);
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

// Drive a link spawn in Chromium's real pipeline order: the tab is created
// (tabs.onCreated) and its creating navigation then starts
// (webNavigation.onCreatedNavigationTarget) while the onCreated listener is
// still awaiting its first API call. Ownership must come from the events
// themselves — no clocks, no settling delays.
async function linkSpawnFromLil(env, { windowId, url, sourceTabId }) {
  const created = env.chrome.tabs.create({ windowId, url, active: true });
  const entry = env.journal().find((e) => e.op === "tabs.create" && e.create.url === url);
  await env.createdNavigationTarget({ tabId: entry.tabId, sourceTabId, url });
  await created;
  await env.flush();
  return entry.tabId;
}

test("an opener-less link spawn is owned by the link flow even when tabs.onCreated runs first", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");
  assert.equal(source.focused, true);

  // rel="noopener" style spawn: no openerTabId, so only the
  // onCreatedNavigationTarget event ties it to the link flow. The claim wins
  // over the in-flight new-tab flow regardless of listener order (issue #18).
  const spawnedId = await linkSpawnFromLil(env, {
    windowId: normal.id,
    url: "https://noopener.example/",
    sourceTabId: source.tabs[0].id,
  });

  assert.equal(
    env.journal().filter((e) => e.op === "windows.create" && e.create.tabId === spawnedId).length,
    1,
    "exactly one flow re-parents the claimed spawn — never both"
  );
  const cascaded = env.windows().find((w) => w.type === "popup" && w.id !== source.id);
  assert.ok(cascaded, "the link flow cascades a genuine requested target (issue #16)");
  assert.equal(cascaded.tabs[0].id, spawnedId);
  assert.deepEqual(JSON.parse(JSON.stringify(env.registry()[String(cascaded.id)].priorContext)), {
    kind: "lil",
    windowId: source.id,
  });
  const hostNow = env.windows().find((w) => w.id === normal.id);
  assert.equal(hostNow.tabs.some((t) => t.id === spawnedId), false, "the spawn left its normal window");
  const sourceNow = env.windows().find((w) => w.id === source.id);
  assert.equal(sourceNow.tabs[0].url, "https://lil.example/", "the source lil is not navigated");
});

test("an OAuth link spawn is left alone even when tabs.onCreated runs before the navigation claim", async () => {
  const env = await boot();
  await env.deliver(fixture("message-context"));
  const normal = await env.chrome.windows.create({ url: "https://host.example/", type: "normal" });
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const source = env.windows().find((w) => w.type === "popup");
  assert.equal(source.focused, true);

  const spawnedId = await linkSpawnFromLil(env, {
    windowId: normal.id,
    url: "https://accounts.google.com/o/oauth2/auth?client_id=example",
    sourceTabId: source.tabs[0].id,
  });

  assert.equal(env.windows().filter((w) => w.type === "popup").length, 1, "the OAuth spawn was never converted");
  assert.equal(
    journalHas(env, "windows.create", (e) => e.create.tabId === spawnedId),
    false
  );
  assert.ok(env.windows().find((w) => w.id === normal.id).tabs.some((t) => t.id === spawnedId));
  assert.deepEqual(Object.keys(env.registry()), [String(source.id)]);
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
