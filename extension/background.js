// lil-chromium background service worker (v0.3).
//
// Responsibilities:
//   - Hold a native-messaging port to the relay host open forever (keep-alive).
//   - Open ephemeral "lils" on `open` messages and answer history queries.
//   - Track every lil in a persistent registry so parked lils survive
//     browser restarts/crashes/updates (restored on onStartup).
//   - Handshake with the host for browser identity + full user config.
//   - New-window link handling (v3): preserve native popups (OAuth fix),
//     re-parent normal-window spawns per linkBehavior.
//   - Focus discipline (v3): MRU stack + explicit refocus.
//   - Ephemerality (v3): per-lil expiry + 1-min sweep alarm.
//   - Sleep (v3): captureVisibleTab → IndexedDB → sleep.html; auto + manual.
//   - Incognito lils (v3): gated on isAllowedIncognitoAccess.
//   - Omnibox history suggestions (v3) for the hover bar.
//   - Promote a lil into normal browsing or hand it to another browser.

const NATIVE_HOST = "com.lilchromium.relay";
// Registry entry shape (v3):
//   { url, bounds:{left,top,width,height},
//     expiry: "never"|"quit"|<hoursNumber>, lastInteraction: ts,
//     slept?: bool, sleepCaptureKey?: string, originalUrl?: string }
const REGISTRY_KEY = "ephemeralWindows";
const LAST_SIZE_KEY = "lastSize"; // {width, height} — last user-resized lil size
const CONTEXT_KEY = "hostContext"; // cached `context` reply (stale-but-usable)
const CONTEXT_TS_KEY = "hostContextTs"; // when the cache was last refreshed
const DEFAULT_SIZE = { width: 1100, height: 800 };
const HISTORY_WINDOW_MS = 90 * 24 * 3600 * 1000; // 90 days
const CASCADE_OFFSET = 32;

// Context handshake: how long a clickHint is considered a match for a nav target.
const CLICK_HINT_TTL_MS = 1500;
const CLICK_HINT_MAX = 10; // ring buffer size

const SWEEP_ALARM = "lil-sweep";
const SWEEP_PERIOD_MIN = 1; // 1-minute periodic sweep
const CONTEXT_STALE_MS = 5 * 60 * 1000; // refresh context before sweep if older

// Settle-retry tuning for new-window link handling.
const SETTLE_RETRIES = 5;
const SETTLE_DELAY_MS = 40;

// captureVisibleTab hard limit is 2/sec globally; we serialize with a min gap.
const CAPTURE_MIN_GAP_MS = 550;

// OAuth / sign-in guard list. New-window targets whose URL matches any of these
// are treated as native auth popups and LEFT UNTOUCHED (preserves window.opener
// / postMessage). See research-v0.3.md §Auth-popup fix.
const OAUTH_GUARDS = [
  "accounts.google.com/o/oauth2",
  "accounts.google.com/signin/oauth",
  "appleid.apple.com/auth",
  "login.microsoftonline.com",
  "login.live.com",
  "github.com/login/oauth",
  "facebook.com/dialog/oauth",
  "/oauth/authorize",
  "/oauth2/authorize",
];
// Host-suffix guards (match on hostname ending).
const OAUTH_HOST_SUFFIXES = ["auth0.com", "okta.com"];

// Built-in fallback context — used before the first handshake completes, or if
// the host never answers. Mirrors PROTOCOL.md v3 defaults.
const DEFAULT_SLEEP = {
  enabled: false,
  afterMinutes: 30,
  audioGuard: true,
  formGuard: true,
  tint: "purple",
  whitelist: [],
};
const DEFAULT_SEARCH = { name: "Startpage", template: "https://www.startpage.com/sp/search?query=%s" };
const DEFAULT_HOVERBAR = { style: "glass", tint: null };
const DEFAULT_CONTEXT = {
  browser: "chrome",
  browserName: "Chrome",
  defaultBrowser: "helium",
  defaultBrowserName: "Helium",
  fallbackBrowser: "chrome",
  linkBehavior: "new-lil",
  ephemeralDefault: "never",
  sleep: DEFAULT_SLEEP,
  searchEngine: DEFAULT_SEARCH,
  hoverBar: DEFAULT_HOVERBAR,
  knownBrowsers: [],
};

// ---------------------------------------------------------------------------
// Small defensive helpers.
// ---------------------------------------------------------------------------

function log(...args) {
  console.log("[lil-chromium]", ...args);
}

async function safe(promise, label) {
  try {
    return await promise;
  } catch (err) {
    log("caught", label || "", err && err.message ? err.message : err);
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// CONTEXT — browser identity + full user config from the host.
// ---------------------------------------------------------------------------

let contextCache = null; // last known `context` object (in-memory)
let contextTs = 0; // when contextCache was last refreshed (ms epoch)
let contextRequestId = 0;

// Normalize whatever the host sent (or a stale cache) into a full context with
// every v3 field present, so callers never have to null-check config subtrees.
function normalizeContext(msg) {
  const src = msg && typeof msg === "object" ? msg : {};
  const sleep = src.sleep && typeof src.sleep === "object" ? src.sleep : {};
  const searchEngine = src.searchEngine && typeof src.searchEngine === "object" ? src.searchEngine : {};
  const hoverBar = src.hoverBar && typeof src.hoverBar === "object" ? src.hoverBar : {};
  return {
    browser: src.browser || DEFAULT_CONTEXT.browser,
    browserName: src.browserName || DEFAULT_CONTEXT.browserName,
    defaultBrowser: src.defaultBrowser || DEFAULT_CONTEXT.defaultBrowser,
    defaultBrowserName: src.defaultBrowserName || DEFAULT_CONTEXT.defaultBrowserName,
    fallbackBrowser: src.fallbackBrowser || DEFAULT_CONTEXT.fallbackBrowser,
    linkBehavior: src.linkBehavior === "same-lil" ? "same-lil" : "new-lil",
    ephemeralDefault: normalizeExpiry(src.ephemeralDefault, "never"),
    sleep: {
      enabled: !!sleep.enabled,
      afterMinutes: typeof sleep.afterMinutes === "number" ? sleep.afterMinutes : DEFAULT_SLEEP.afterMinutes,
      audioGuard: sleep.audioGuard !== false,
      formGuard: sleep.formGuard !== false,
      tint: typeof sleep.tint === "string" ? sleep.tint : DEFAULT_SLEEP.tint,
      whitelist: Array.isArray(sleep.whitelist) ? sleep.whitelist.slice() : [],
    },
    searchEngine: {
      name: typeof searchEngine.name === "string" ? searchEngine.name : DEFAULT_SEARCH.name,
      template: typeof searchEngine.template === "string" ? searchEngine.template : DEFAULT_SEARCH.template,
    },
    hoverBar: {
      style: hoverBar.style === "solid" ? "solid" : "glass",
      tint: typeof hoverBar.tint === "string" ? hoverBar.tint : null,
    },
    knownBrowsers: Array.isArray(src.knownBrowsers) ? src.knownBrowsers : [],
  };
}

// Returns the best context we have: live cache, else persisted cache, else the
// built-in defaults.
async function getContext() {
  if (contextCache) return contextCache;
  const obj = await safe(chrome.storage.local.get([CONTEXT_KEY, CONTEXT_TS_KEY]), "get context");
  const cached = obj && obj[CONTEXT_KEY];
  if (cached && typeof cached === "object") {
    contextCache = normalizeContext(cached);
    contextTs = (obj && obj[CONTEXT_TS_KEY]) || 0;
    return contextCache;
  }
  return normalizeContext(DEFAULT_CONTEXT);
}

async function storeContext(ctx) {
  contextCache = normalizeContext(ctx);
  contextTs = Date.now();
  await safe(
    chrome.storage.local.set({ [CONTEXT_KEY]: contextCache, [CONTEXT_TS_KEY]: contextTs }),
    "set context"
  );
}

// Ask the host for fresh context. Fire-and-forget: the reply arrives as a
// `context` port message.
function requestContext() {
  contextRequestId += 1;
  postToHost({ type: "get-context", id: "ctx-" + contextRequestId });
}

// Best-effort blocking refresh: post get-context and wait briefly for the reply
// to land (used by the sweep when the cache is stale). Falls through to whatever
// cache exists if the host is slow/absent.
async function refreshContextIfStale() {
  // Make sure the in-memory contextTs reflects the persisted cache (0 right
  // after an SW wake) before deciding staleness.
  await getContext();
  if (Date.now() - contextTs < CONTEXT_STALE_MS) return;
  if (!port) return; // nothing to ask
  requestContext();
  // Wait up to ~600ms for handlePortMessage to update the cache.
  const before = contextTs;
  for (let i = 0; i < 6; i++) {
    await delay(100);
    if (contextTs !== before) return;
  }
}

// ---------------------------------------------------------------------------
// CLICK HINTS — modifier-key relay for link behavior (unchanged from v2).
// ---------------------------------------------------------------------------

const clickHints = []; // ring buffer of {url, meta, ts}

function recordClickHint(url, meta, ts) {
  if (typeof url !== "string" || !url) return;
  clickHints.push({ url, meta: !!meta, ts: typeof ts === "number" ? ts : Date.now() });
  while (clickHints.length > CLICK_HINT_MAX) clickHints.shift();
}

function urlNoHash(u) {
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    return parsed.href;
  } catch (_) {
    const i = u.indexOf("#");
    return i >= 0 ? u.slice(0, i) : u;
  }
}

function consumeClickHint(url) {
  if (typeof url !== "string" || !url) return null;
  const now = Date.now();
  const noHash = urlNoHash(url);
  for (let i = clickHints.length - 1; i >= 0; i--) {
    const h = clickHints[i];
    if (now - h.ts > CLICK_HINT_TTL_MS) continue;
    if (h.url === url) {
      clickHints.splice(i, 1);
      return h;
    }
  }
  for (let i = clickHints.length - 1; i >= 0; i--) {
    const h = clickHints[i];
    if (now - h.ts > CLICK_HINT_TTL_MS) continue;
    if (urlNoHash(h.url) === noHash) {
      clickHints.splice(i, 1);
      return h;
    }
  }
  return null;
}

// ===========================================================================
// FOCUS DISCIPLINE — MRU stack of window ids.
//
// Maintained via windows.onFocusChanged (ignoring WINDOW_ID_NONE). Keeps BOTH
// lil and normal windows so, when a focused lil closes, we can return focus to
// whatever the user was truly on last. Memory-only; rebuilt as the user clicks
// around. Every lil create is followed by an explicit focusWindow() because
// create({focused:true}) is unreliable on macOS (research §Focus).
// ===========================================================================

const mruStack = []; // window ids, most-recent-first

function mruTouch(windowId) {
  if (typeof windowId !== "number" || windowId < 0) return;
  const i = mruStack.indexOf(windowId);
  if (i >= 0) mruStack.splice(i, 1);
  mruStack.unshift(windowId);
  while (mruStack.length > 24) mruStack.pop();
}

function mruRemove(windowId) {
  const i = mruStack.indexOf(windowId);
  if (i >= 0) mruStack.splice(i, 1);
}

// Filter dead ids out of the MRU stack and return the first still-alive id, or
// null. Used when a focused lil closes so we hand focus to a real window.
async function mruTopAlive(excludeId) {
  const all = await safe(chrome.windows.getAll({}), "getAll mru");
  const live = new Set((all || []).map((w) => w.id));
  for (let i = mruStack.length - 1; i >= 0; i--) {
    if (!live.has(mruStack[i])) mruStack.splice(i, 1);
  }
  for (const id of mruStack) {
    if (id !== excludeId && live.has(id)) return id;
  }
  return null;
}

// Explicit focus. Always used after windows.create for a lil.
async function focusWindow(windowId) {
  if (typeof windowId !== "number") return;
  await safe(chrome.windows.update(windowId, { focused: true }), "windows.update focus");
}

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return; // ignore blur-to-none
  mruTouch(windowId);
});

// ===========================================================================
// NATIVE PORT — load-bearing keep-alive (unchanged from v2 except handshake).
// ===========================================================================

let port = null;
let reconnectDelay = 250;
const RECONNECT_MAX = 5000;
let reconnectTimer = null;

function connectNative() {
  if (port) return;
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (err) {
    log("connectNative threw", err && err.message ? err.message : err);
    port = null;
    scheduleReconnect();
    return;
  }

  port.onMessage.addListener(handlePortMessage);
  port.onDisconnect.addListener(() => {
    const le = chrome.runtime.lastError;
    log("native port disconnected", le && le.message ? le.message : "");
    port = null;
    scheduleReconnect();
  });

  reconnectDelay = 250;
  log("native port connected");
  requestContext();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const d = reconnectDelay;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectNative();
  }, d);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
}

function postToHost(msg) {
  if (!port) {
    log("postToHost dropped (no port)", msg && msg.type);
    return false;
  }
  try {
    port.postMessage(msg);
    return true;
  } catch (err) {
    log("postToHost threw", err && err.message ? err.message : err);
    return false;
  }
}

async function handlePortMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  try {
    if (msg.type === "open") {
      if (msg.incognito) {
        await openIncognitoLil(msg.url, msg.left, msg.top);
      } else {
        await openLittleWindow(msg.url, msg.left, msg.top);
      }
    } else if (msg.type === "history-query") {
      await answerHistoryQuery(msg);
    } else if (msg.type === "context") {
      await storeContext(msg);
      log(
        "context updated",
        "browser=" + msg.browser,
        "default=" + msg.defaultBrowser,
        "link=" + msg.linkBehavior
      );
    } else {
      log("unknown port message", msg.type);
    }
  } catch (err) {
    log("handlePortMessage error", err && err.message ? err.message : err);
  }
}

async function answerHistoryQuery(msg) {
  const results = await safe(
    chrome.history.search({
      text: typeof msg.text === "string" ? msg.text : "",
      maxResults: typeof msg.maxResults === "number" ? msg.maxResults : 100,
      startTime: Date.now() - HISTORY_WINDOW_MS,
    }),
    "history.search"
  );
  const items = (results || []).map((h) => ({
    url: h.url,
    title: h.title || "",
    lastVisitTime: h.lastVisitTime || 0,
    visitCount: h.visitCount || 0,
    typedCount: h.typedCount || 0,
  }));
  postToHost({ type: "history-result", id: msg.id, items });
}

// ===========================================================================
// REGISTRY — persistent record of little windows (v3 fields).
// ===========================================================================

async function getRegistry() {
  const obj = await safe(chrome.storage.local.get(REGISTRY_KEY), "get registry");
  return (obj && obj[REGISTRY_KEY]) || {};
}

async function setRegistry(reg) {
  await safe(chrome.storage.local.set({ [REGISTRY_KEY]: reg }), "set registry");
}

// Normalize expiry into "never" | "quit" | <hoursNumber>.
function normalizeExpiry(v, fallback) {
  if (v === "never" || v === "quit") return v;
  if (typeof v === "number" && v > 0) return v;
  if (typeof v === "string") {
    const m = /^(\d+)h?$/.exec(v.trim());
    if (m) return parseInt(m[1], 10);
    if (v === "never" || v === "quit") return v;
  }
  return fallback === undefined ? "never" : fallback;
}

async function registerWindow(windowId, url, bounds, extra) {
  const reg = await getRegistry();
  const prev = reg[String(windowId)] || {};
  reg[String(windowId)] = Object.assign(
    {
      url,
      bounds,
      expiry: prev.expiry !== undefined ? prev.expiry : "never",
      lastInteraction: Date.now(),
    },
    prev,
    { url, bounds },
    extra || {}
  );
  await setRegistry(reg);
}

async function deregisterWindow(windowId) {
  const reg = await getRegistry();
  if (reg[String(windowId)] !== undefined) {
    delete reg[String(windowId)];
    await setRegistry(reg);
  }
}

// A window is a "lil" if it's in the persistent registry OR the in-memory
// incognito set (incognito lils are never persisted).
async function isEphemeralWindow(windowId) {
  if (windowId === undefined || windowId === null) return false;
  if (incognitoLils.has(windowId)) return true;
  const reg = await getRegistry();
  return Object.prototype.hasOwnProperty.call(reg, String(windowId));
}

async function getLastSize() {
  const obj = await safe(chrome.storage.local.get(LAST_SIZE_KEY), "get lastSize");
  const s = obj && obj[LAST_SIZE_KEY];
  if (s && typeof s.width === "number" && typeof s.height === "number") return s;
  return { ...DEFAULT_SIZE };
}

async function setLastSize(width, height) {
  if (typeof width !== "number" || typeof height !== "number") return;
  await safe(chrome.storage.local.set({ [LAST_SIZE_KEY]: { width, height } }), "set lastSize");
}

// ===========================================================================
// DISPLAY CLAMPING (unchanged from v2).
// ===========================================================================

function pointInArea(x, y, area) {
  return x >= area.left && x < area.left + area.width && y >= area.top && y < area.top + area.height;
}

async function clampBounds(left, top, width, height) {
  const displays = await safe(chrome.system.display.getInfo(), "display.getInfo");
  const list = displays && displays.length ? displays : null;

  let target = null;
  const haveCoords = typeof left === "number" && typeof top === "number";

  if (list) {
    if (haveCoords) {
      target = list.find((d) => pointInArea(left, top, d.workArea)) || null;
    }
    if (!target) target = list.find((d) => d.isPrimary) || list[0];
  }

  if (!target) {
    return {
      left: haveCoords ? Math.round(left) : undefined,
      top: haveCoords ? Math.round(top) : undefined,
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  const wa = target.workArea;
  const w = Math.min(Math.round(width), wa.width);
  const h = Math.min(Math.round(height), wa.height);

  let x, y;
  if (haveCoords) {
    x = Math.round(left);
    y = Math.round(top);
  } else {
    x = wa.left + Math.round((wa.width - w) / 2);
    y = wa.top + Math.round((wa.height - h) / 2);
  }

  x = Math.max(wa.left, Math.min(x, wa.left + wa.width - w));
  y = Math.max(wa.top, Math.min(y, wa.top + wa.height - h));

  return { left: x, top: y, width: w, height: h };
}

// ===========================================================================
// LITTLE WINDOW CREATION
// ===========================================================================

async function openLittleWindow(url, left, top) {
  if (typeof url !== "string" || !url) {
    log("openLittleWindow: missing url");
    return null;
  }
  const ctx = await getContext();
  const size = await getLastSize();
  const bounds = await clampBounds(left, top, size.width, size.height);

  const createOpts = { url, type: "popup", focused: true, width: bounds.width, height: bounds.height };
  if (bounds.left !== undefined) createOpts.left = bounds.left;
  if (bounds.top !== undefined) createOpts.top = bounds.top;

  const win = await safe(chrome.windows.create(createOpts), "windows.create little");
  if (!win || win.id === undefined) return null;

  // Explicit refocus (create({focused:true}) unreliable when not frontmost).
  await focusWindow(win.id);
  mruTouch(win.id);

  await registerWindow(
    win.id,
    url,
    { left: win.left, top: win.top, width: win.width, height: win.height },
    { expiry: ctx.ephemeralDefault, lastInteraction: Date.now() }
  );
  return win;
}

// ===========================================================================
// INCOGNITO LILS (v3).
//
// In-memory only: never persisted to the restore registry, never slept/captured.
// Gated on isAllowedIncognitoAccess(); if off, fall back to a NORMAL lil and
// tell the content overlay to show a hint toast pointing at the toggle.
// ===========================================================================

const incognitoLils = new Set(); // window ids of live incognito lils

async function openIncognitoLil(url, left, top) {
  if (typeof url !== "string" || !url) return null;
  const allowed = await safe(chrome.extension.isAllowedIncognitoAccess(), "isAllowedIncognitoAccess");
  if (!allowed) {
    // Fall back to a normal lil and ask its overlay to surface the toggle hint.
    const win = await openLittleWindow(url, left, top);
    if (win && win.id !== undefined) queueIncognitoHint(win.id);
    return win;
  }

  const size = await getLastSize();
  const bounds = await clampBounds(left, top, size.width, size.height);
  const opts = {
    url,
    type: "popup",
    incognito: true,
    focused: true,
    width: bounds.width,
    height: bounds.height,
  };
  if (bounds.left !== undefined) opts.left = bounds.left;
  if (bounds.top !== undefined) opts.top = bounds.top;

  const win = await safe(chrome.windows.create(opts), "windows.create incognito");
  if (!win || win.id === undefined) {
    // lastError (toggle raced off, etc.) → normal fallback.
    const fb = await openLittleWindow(url, left, top);
    if (fb && fb.id !== undefined) queueIncognitoHint(fb.id);
    return fb;
  }
  await focusWindow(win.id);
  mruTouch(win.id);
  incognitoLils.add(win.id);
  return win;
}

// When we fall back to a normal lil in place of an incognito one, the overlay
// asks for pending hints once it mounts (it can't receive a message before the
// content script loads). We hold a one-shot per window id.
const pendingIncognitoHints = new Set();
function queueIncognitoHint(windowId) {
  pendingIncognitoHints.add(windowId);
  // Best-effort immediate push too, in case the overlay is already mounted.
  broadcastToWindow(windowId, { action: "incognitoHint" });
}

// Send a message to whatever tab currently occupies a lil window.
async function broadcastToWindow(windowId, message) {
  const tabs = await safe(chrome.tabs.query({ windowId }), "tabs.query broadcast");
  const tab = tabs && tabs[0];
  if (tab && tab.id !== undefined) {
    try {
      chrome.tabs.sendMessage(tab.id, message, () => void chrome.runtime.lastError);
    } catch (_) {
      /* no receiver */
    }
  }
}

// ===========================================================================
// RESTORE — parked lils survive restart. Skips "quit"-expiry lils; slept lils
// reopen as their sleep page.
// ===========================================================================

async function restoreWindows() {
  const oldReg = await getRegistry();
  const entries = Object.values(oldReg);
  if (!entries.length) return;

  await setRegistry({});

  let restored = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.url !== "string" || !entry.url) continue;
    if (entry.expiry === "quit") continue; // excluded from restore

    const b = entry.bounds || {};
    const clamped = await clampBounds(
      b.left,
      b.top,
      b.width || DEFAULT_SIZE.width,
      b.height || DEFAULT_SIZE.height
    );

    // Slept lils reopen straight to their sleep page (screenshot still in IDB).
    let openUrl = entry.url;
    if (entry.slept && entry.sleepCaptureKey && entry.originalUrl) {
      openUrl = sleepPageUrl(entry.sleepCaptureKey, entry.originalUrl);
    }

    const opts = { url: openUrl, type: "popup", focused: false, width: clamped.width, height: clamped.height };
    if (clamped.left !== undefined) opts.left = clamped.left;
    if (clamped.top !== undefined) opts.top = clamped.top;

    const win = await safe(chrome.windows.create(opts), "windows.create restore");
    if (win && win.id !== undefined) {
      await registerWindow(
        win.id,
        entry.url,
        { left: win.left, top: win.top, width: win.width, height: win.height },
        {
          expiry: normalizeExpiry(entry.expiry, "never"),
          lastInteraction: Date.now(),
          slept: !!entry.slept,
          sleepCaptureKey: entry.sleepCaptureKey,
          originalUrl: entry.originalUrl,
        }
      );
      restored += 1;
    }
  }
  log("restored", restored, "little window(s)");
}

// ===========================================================================
// REGISTRY UPKEEP — react to tab/window events.
// ===========================================================================

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  if (!tab || tab.windowId === undefined) return;
  const reg = await getRegistry();
  const key = String(tab.windowId);
  if (reg[key]) {
    // Don't overwrite the "real" url with the sleep-page URL — slept entries
    // keep their originalUrl and are managed by sleep/wake directly.
    if (reg[key].slept) return;
    reg[key].url = changeInfo.url;
    await setRegistry(reg);
  }
});

chrome.windows.onBoundsChanged.addListener(async (win) => {
  if (!win || win.id === undefined) return;
  const reg = await getRegistry();
  const key = String(win.id);
  if (!reg[key]) return;
  reg[key].bounds = { left: win.left, top: win.top, width: win.width, height: win.height };
  await setRegistry(reg);
  if (typeof win.width === "number" && typeof win.height === "number") {
    await setLastSize(win.width, win.height);
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const wasIncognito = incognitoLils.delete(windowId);
  const reg = await getRegistry();
  const entry = reg[String(windowId)];
  const wasLil = !!entry || wasIncognito;

  // Was this the focused window? If so, restore focus to the MRU top.
  const wasFocused = mruStack[0] === windowId;
  mruRemove(windowId);

  // Clean up any stored capture for this lil.
  if (entry && entry.sleepCaptureKey) {
    await safe(idbDelete(entry.sleepCaptureKey), "idb delete onRemoved");
  }
  await deregisterWindow(windowId);

  if (wasLil && wasFocused) {
    const top = await mruTopAlive(windowId);
    if (top !== null) await focusWindow(top);
  }
});

// ===========================================================================
// NEW-WINDOW LINK HANDLING (v3) — the auth-popup fix + focus discipline.
//
// On onCreatedNavigationTarget from a lil, WAIT for the tab to settle, then:
//   - window.type === "popup" OR openerTabId missing OR OAuth-guard URL
//       → do NOTHING (preserve the native popup: window.opener/postMessage).
//   - landed as a tab in a NORMAL window
//       → effective behavior = config linkBehavior flipped by ⌘ clickHint:
//         new-lil  → re-parent into a new cascaded lil (create → focus)
//         same-lil → navigate the source tab + remove the spawned tab + refocus
// ===========================================================================

// Reusable settle helper. Retries tabs.get / windows.get up to SETTLE_RETRIES
// with small delays until both resolve. Returns {tab, win} or null.
async function settleTabAndWindow(tabId) {
  for (let i = 0; i < SETTLE_RETRIES; i++) {
    const tab = await safe(chrome.tabs.get(tabId), "settle tabs.get");
    if (tab && tab.windowId !== undefined && tab.windowId >= 0) {
      const win = await safe(chrome.windows.get(tab.windowId), "settle windows.get");
      if (win && win.id !== undefined) return { tab, win };
    }
    await delay(SETTLE_DELAY_MS);
  }
  // Last attempt without the extra delay.
  const tab = await safe(chrome.tabs.get(tabId), "settle tabs.get final");
  if (tab && tab.windowId !== undefined) {
    const win = await safe(chrome.windows.get(tab.windowId), "settle windows.get final");
    if (win) return { tab, win };
  }
  return null;
}

function matchesOAuthGuard(url) {
  if (typeof url !== "string" || !url) return false;
  const lower = url.toLowerCase();
  for (const frag of OAUTH_GUARDS) {
    if (lower.includes(frag)) return true;
  }
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const suf of OAUTH_HOST_SUFFIXES) {
      if (host === suf || host.endsWith("." + suf)) return true;
    }
  } catch (_) {
    /* unparseable — fall through */
  }
  return false;
}

// Cascade an existing tab into its own offset popup lil. Registers + focuses it.
async function cascadeTabToLil(tabId, srcWindowId, fallbackUrl) {
  const ctx = await getContext();
  const srcWin = await safe(chrome.windows.get(srcWindowId), "windows.get source");
  const baseLeft = srcWin && typeof srcWin.left === "number" ? srcWin.left : 0;
  const baseTop = srcWin && typeof srcWin.top === "number" ? srcWin.top : 0;
  const size = await getLastSize();

  const clamped = await clampBounds(baseLeft + CASCADE_OFFSET, baseTop + CASCADE_OFFSET, size.width, size.height);

  const opts = { tabId, type: "popup", focused: true, width: clamped.width, height: clamped.height };
  if (clamped.left !== undefined) opts.left = clamped.left;
  if (clamped.top !== undefined) opts.top = clamped.top;

  const win = await safe(chrome.windows.create(opts), "windows.create cascade");
  if (win && win.id !== undefined) {
    await focusWindow(win.id); // explicit — create({focused:true}) unreliable
    mruTouch(win.id);
    const url = fallbackUrl || (win.tabs && win.tabs[0] && win.tabs[0].url) || "";
    await registerWindow(
      win.id,
      url || "",
      { left: win.left, top: win.top, width: win.width, height: win.height },
      { expiry: ctx.ephemeralDefault, lastInteraction: Date.now() }
    );
  }
  return win;
}

chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  try {
    const srcTab = await safe(chrome.tabs.get(details.sourceTabId), "tabs.get source");
    if (!srcTab || srcTab.windowId === undefined) return;
    if (!(await isEphemeralWindow(srcTab.windowId))) return;

    // WAIT for the spawned tab to settle before deciding (race is real).
    const settled = await settleTabAndWindow(details.tabId);
    if (!settled) return; // tab vanished — nothing to do
    const { tab, win } = settled;

    // ---- Branch 1: native popup / auth window → LEAVE UNTOUCHED. ----
    const isPopupWindow = win.type === "popup";
    const noOpener = tab.openerTabId === undefined || tab.openerTabId === null;
    const authUrl = matchesOAuthGuard(details.url) || matchesOAuthGuard(tab.url);
    if (isPopupWindow || noOpener || authUrl) {
      log("new-window: preserving native popup", win.type, "opener=" + tab.openerTabId);
      return; // no re-parent, no navigate, no registry
    }

    // ---- Branch 2: landed in a NORMAL window → apply linkBehavior. ----
    const ctx = await getContext();
    let behavior = ctx.linkBehavior === "same-lil" ? "same-lil" : "new-lil";
    const hint = consumeClickHint(details.url);
    if (hint && hint.meta) behavior = behavior === "same-lil" ? "new-lil" : "same-lil";

    if (behavior === "same-lil") {
      const updated = await safe(chrome.tabs.update(srcTab.id, { url: details.url }), "tabs.update same-lil");
      await safe(chrome.tabs.remove(tab.id), "tabs.remove spawned");
      // Focus must NEVER remain on the main window — refocus the source lil.
      await focusWindow(srcTab.windowId);
      if (updated === null) {
        await cascadeTabToLil(tab.id, srcTab.windowId, details.url);
      }
      return;
    }

    // "new-lil": re-parent the spawned tab into its own cascaded lil.
    await cascadeTabToLil(tab.id, srcTab.windowId, details.url);
  } catch (err) {
    log("new-window handling error", err && err.message ? err.message : err);
  }
});

// ===========================================================================
// SLEEP SYSTEM (v3).
//
// Pipeline: captureVisibleTab (throttled ≤2/sec) → dataURL→Blob→IndexedDB →
// mark registry {slept, sleepCaptureKey, originalUrl} → navigate the tab to
// sleep.html. Wake: sleep page click → wakeLil → navigate back + delete capture.
// ===========================================================================

const IDB_NAME = "lil-sleep";
const IDB_STORE = "captures";

function idbOpen() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(IDB_NAME, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(key, blob) {
  return idbOpen().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(blob, key);
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

function idbDelete(key) {
  return idbOpen().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

function idbKeys() {
  return idbOpen().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).getAllKeys();
        req.onsuccess = () => {
          db.close();
          resolve(req.result || []);
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      })
  );
}

// Build the sleep-page URL for a given capture key + original URL + tint.
function sleepPageUrl(captureKey, originalUrl, tint) {
  const params = new URLSearchParams();
  params.set("k", captureKey);
  params.set("u", originalUrl || "");
  if (tint) params.set("tint", tint);
  return chrome.runtime.getURL("sleep.html") + "?" + params.toString();
}

// Global capture throttle: serialize captures with a min gap so we never exceed
// 2 calls/sec anywhere in the SW.
let captureChain = Promise.resolve();
let lastCaptureTs = 0;

function throttledCapture(windowId) {
  const run = async () => {
    const since = Date.now() - lastCaptureTs;
    if (since < CAPTURE_MIN_GAP_MS) await delay(CAPTURE_MIN_GAP_MS - since);
    lastCaptureTs = Date.now();
    return safe(
      chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 60 }),
      "captureVisibleTab"
    );
  };
  // Chain so concurrent sleeps serialize; swallow rejections to keep the chain.
  const next = captureChain.then(run, run);
  captureChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function dataUrlToBlob(dataUrl) {
  try {
    const comma = dataUrl.indexOf(",");
    const header = dataUrl.slice(0, comma);
    const b64 = dataUrl.slice(comma + 1);
    const mimeMatch = /data:([^;]+)/.exec(header);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch (e) {
    log("dataUrlToBlob failed", e && e.message ? e.message : e);
    return null;
  }
}

// Put a lil to sleep. Caller has already checked guards. Returns true on success.
async function sleepLil(windowId) {
  if (incognitoLils.has(windowId)) return false; // never sleep incognito lils
  const reg = await getRegistry();
  const entry = reg[String(windowId)];
  if (!entry || entry.slept) return false;

  const tabs = await safe(chrome.tabs.query({ windowId, active: true }), "tabs.query sleep");
  const tab = tabs && tabs[0];
  if (!tab || tab.id === undefined) return false;
  const originalUrl = tab.url || entry.url || "";
  if (!originalUrl || /^chrome-extension:\/\//i.test(originalUrl)) return false; // already a lil page

  const dataUrl = await throttledCapture(windowId);
  if (!dataUrl) {
    log("sleepLil: capture failed for", windowId);
    return false;
  }
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return false;

  const captureKey = windowId + "-" + Date.now();
  const stored = await safe(idbPut(captureKey, blob), "idbPut capture");
  if (!stored) return false;

  const ctx = await getContext();
  const tint = ctx.sleep && ctx.sleep.tint ? ctx.sleep.tint : "purple";

  // Mark registry BEFORE navigating so onUpdated doesn't clobber originalUrl.
  const reg2 = await getRegistry();
  if (reg2[String(windowId)]) {
    reg2[String(windowId)].slept = true;
    reg2[String(windowId)].sleepCaptureKey = captureKey;
    reg2[String(windowId)].originalUrl = originalUrl;
    await setRegistry(reg2);
  }

  await safe(chrome.tabs.update(tab.id, { url: sleepPageUrl(captureKey, originalUrl, tint) }), "tabs.update sleep");
  log("slept lil", windowId);
  return true;
}

// Wake a slept lil: navigate its tab back to the original URL, delete capture,
// clear the registry sleep marks. Called from the sleep page's wake message.
async function wakeLil(windowId) {
  const reg = await getRegistry();
  const entry = reg[String(windowId)];
  if (!entry) return false;
  const originalUrl = entry.originalUrl || entry.url;
  const captureKey = entry.sleepCaptureKey;

  const tabs = await safe(chrome.tabs.query({ windowId, active: true }), "tabs.query wake");
  const tab = tabs && tabs[0];
  if (tab && tab.id !== undefined && originalUrl) {
    await safe(chrome.tabs.update(tab.id, { url: originalUrl }), "tabs.update wake");
  }

  // Clear sleep marks; keep the lil registered as a normal live lil.
  const reg2 = await getRegistry();
  if (reg2[String(windowId)]) {
    reg2[String(windowId)].slept = false;
    delete reg2[String(windowId)].sleepCaptureKey;
    delete reg2[String(windowId)].originalUrl;
    reg2[String(windowId)].url = originalUrl;
    reg2[String(windowId)].lastInteraction = Date.now();
    await setRegistry(reg2);
  }
  if (captureKey) await safe(idbDelete(captureKey), "idbDelete wake");
  log("woke lil", windowId);
  return true;
}

// Host of a URL (lowercased hostname), or "".
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
}

// Does a host match any whitelist domain (exact or subdomain)?
function hostWhitelisted(host, whitelist) {
  if (!host || !Array.isArray(whitelist)) return false;
  for (const d of whitelist) {
    if (typeof d !== "string" || !d) continue;
    const dom = d.toLowerCase();
    if (host === dom || host.endsWith("." + dom)) return true;
  }
  return false;
}

// ===========================================================================
// SWEEP — one 1-minute alarm drives ephemerality auto-close, auto-sleep, and
// IndexedDB orphan cleanup. Registered at top level; re-created on startup.
// ===========================================================================

async function ensureSweepAlarm() {
  const existing = await safe(chrome.alarms.get(SWEEP_ALARM), "alarms.get");
  if (!existing) {
    await safe(
      chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: SWEEP_PERIOD_MIN }),
      "alarms.create"
    );
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== SWEEP_ALARM) return;
  runSweep();
});

let sweeping = false;
async function runSweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    await refreshContextIfStale();
    const ctx = await getContext();
    const now = Date.now();
    const reg = await getRegistry();
    // Determine the currently focused window. Prefer the live query (survives SW
    // restarts where the MRU stack is empty); fall back to the MRU top.
    const lastFocused = await safe(chrome.windows.getLastFocused({}), "sweep getLastFocused");
    let focusedTop =
      lastFocused && lastFocused.focused && lastFocused.id !== undefined ? lastFocused.id : mruStack[0];

    for (const [key, entry] of Object.entries(reg)) {
      const windowId = parseInt(key, 10);
      if (!entry) continue;

      // --- Ephemerality: auto-close hour-expiry lils idle past their limit. ---
      if (typeof entry.expiry === "number" && entry.expiry > 0) {
        const idleMs = now - (entry.lastInteraction || 0);
        if (idleMs > entry.expiry * 3600 * 1000) {
          log("ephemeral close", windowId, "idle(min)=" + Math.round(idleMs / 60000));
          await deregisterWindow(windowId);
          if (entry.sleepCaptureKey) await safe(idbDelete(entry.sleepCaptureKey), "idb ephemeral");
          mruRemove(windowId);
          await safe(chrome.windows.remove(windowId), "windows.remove ephemeral");
          continue; // gone — skip sleep checks
        }
      }

      // --- Auto-sleep: only if enabled and all guards pass. ---
      if (!ctx.sleep || !ctx.sleep.enabled) continue;
      if (entry.slept) continue; // already asleep
      if (incognitoLils.has(windowId)) continue; // never sleep incognito

      const idleMs = now - (entry.lastInteraction || 0);
      if (idleMs <= ctx.sleep.afterMinutes * 60 * 1000) continue; // not idle enough
      if (windowId === focusedTop) continue; // focused window

      const tabs = await safe(chrome.tabs.query({ windowId, active: true }), "tabs.query sweep");
      const tab = tabs && tabs[0];
      if (!tab) continue;
      if (ctx.sleep.audioGuard && tab.audible) continue; // playing audio
      if (ctx.sleep.formGuard && dirtyTabs.has(tab.id)) continue; // unsubmitted form
      const host = hostOf(tab.url || entry.url);
      if (hostWhitelisted(host, ctx.sleep.whitelist)) continue; // whitelisted

      await sleepLil(windowId);
    }

    await cleanupOrphanCaptures();
  } catch (err) {
    log("sweep error", err && err.message ? err.message : err);
  } finally {
    sweeping = false;
  }
}

// Delete IndexedDB captures whose window no longer exists or whose registry
// entry no longer references them.
async function cleanupOrphanCaptures() {
  const keys = await safe(idbKeys(), "idbKeys");
  if (!keys || !keys.length) return;
  const reg = await getRegistry();
  const referenced = new Set();
  for (const entry of Object.values(reg)) {
    if (entry && entry.sleepCaptureKey) referenced.add(entry.sleepCaptureKey);
  }
  for (const k of keys) {
    if (!referenced.has(k)) {
      await safe(idbDelete(k), "idbDelete orphan");
    }
  }
}

// ===========================================================================
// FORM-DIRTY + INTERACTION STATE (fed by the content script).
// ===========================================================================

const dirtyTabs = new Set(); // tab ids with unsubmitted form input

async function refreshLastInteraction(windowId) {
  if (windowId === undefined) return;
  const reg = await getRegistry();
  if (reg[String(windowId)]) {
    reg[String(windowId)].lastInteraction = Date.now();
    await setRegistry(reg);
  }
}

// ===========================================================================
// PROMOTE — get a lil's tab out of ephemeral mode (unchanged from v2, plus
// focus discipline + MRU cleanup).
// ===========================================================================

async function findNormalWindow() {
  const lf = await safe(chrome.windows.getLastFocused({ windowTypes: ["normal"] }), "getLastFocused normal");
  if (lf && lf.type === "normal" && lf.id !== undefined) return lf;

  const all = await safe(chrome.windows.getAll({ windowTypes: ["normal"] }), "getAll normal");
  if (all && all.length) {
    const focused = all.find((w) => w.focused);
    return focused || all[all.length - 1];
  }
  return null;
}

async function moveTabIntoHostBrowser(tabId, groupId) {
  const tab = await safe(chrome.tabs.get(tabId), "tabs.get promote");
  if (!tab) return false;
  const sourceWindowId = tab.windowId;

  let ok = false;

  if (typeof groupId === "number") {
    const res = await safe(chrome.tabs.group({ tabIds: [tabId], groupId }), "tabs.group");
    if (res !== null) {
      const g = await safe(chrome.tabGroups.get(groupId), "tabGroups.get");
      if (g && g.windowId !== undefined) {
        await safe(chrome.tabs.update(tabId, { active: true }), "tabs.update active group");
        await safe(chrome.windows.update(g.windowId, { focused: true }), "windows.update focus group");
      }
      ok = true;
    }
  } else {
    const target = await findNormalWindow();
    if (target && target.id !== undefined) {
      const moved = await safe(chrome.tabs.move(tabId, { windowId: target.id, index: -1 }), "tabs.move promote");
      if (moved !== null) {
        await safe(chrome.tabs.update(tabId, { active: true }), "tabs.update active");
        await safe(chrome.windows.update(target.id, { focused: true }), "windows.update focus");
        ok = true;
      }
    }
    if (!ok) {
      const win = await safe(chrome.windows.create({ tabId, focused: true }), "windows.create promote-fallback");
      ok = !!win;
    }
    if (!ok && tab.url) {
      const target = await findNormalWindow();
      const createOpts = { url: tab.url, active: true };
      if (target && target.id !== undefined) createOpts.windowId = target.id;
      const t = await safe(chrome.tabs.create(createOpts), "tabs.create last-resort");
      if (t) {
        await safe(chrome.tabs.remove(tabId), "tabs.remove old");
        ok = true;
      }
    }
  }

  if (ok) {
    mruRemove(sourceWindowId);
    await deregisterWindow(sourceWindowId);
  }
  return ok;
}

async function handOffToBrowser(tabId, browserSlug) {
  const tab = await safe(chrome.tabs.get(tabId), "tabs.get handoff");
  if (!tab || !tab.url) return false;
  const posted = postToHost({ type: "open-external", browser: browserSlug, url: tab.url });
  const wid = tab.windowId;
  if (wid !== undefined) {
    mruRemove(wid);
    await deregisterWindow(wid);
    await safe(chrome.windows.remove(wid), "windows.remove handoff");
  }
  return posted;
}

async function promoteTab(tabId, dest, groupId, browser) {
  const ctx = await getContext();

  if (dest === "group" && typeof groupId === "number") return moveTabIntoHostBrowser(tabId, groupId);
  if (dest === "host-tab") return moveTabIntoHostBrowser(tabId, undefined);
  if (dest === "browser" && typeof browser === "string" && browser) return handOffToBrowser(tabId, browser);
  if (ctx.defaultBrowser && ctx.defaultBrowser === ctx.browser) return moveTabIntoHostBrowser(tabId, undefined);
  return handOffToBrowser(tabId, ctx.defaultBrowser || DEFAULT_CONTEXT.defaultBrowser);
}

// Open a URL into a lil already living in `windowId` per link behavior. Used by
// context-menu handlers.
async function openLinkForLil(windowId, url, mode) {
  if (typeof url !== "string" || !url) return;
  if (mode === "same-lil") {
    const tabs = await safe(chrome.tabs.query({ windowId, active: true }), "tabs.query lil");
    const tab = tabs && tabs[0];
    if (tab && tab.id !== undefined) {
      await safe(chrome.tabs.update(tab.id, { url }), "tabs.update ctxmenu same-lil");
    }
    return;
  }
  const created = await safe(chrome.tabs.create({ windowId, url, active: false }), "tabs.create ctxmenu");
  if (created && created.id !== undefined) {
    await cascadeTabToLil(created.id, windowId, url);
  }
}

// ===========================================================================
// OMNIBOX HISTORY SUGGESTIONS (v3).
//
// The hover bar's address field asks for ranked history matches. We fetch a
// broad history.search then rank origin-first, port of the v0.2 palette ranking:
//   host-prefix match (tier 1000) > title word-boundary (300) > contains (150)
//   > dense fuzzy (low), multiplied by log-frecency; dedupe by host+path,
//   aggregate origins, ≤3 rows per host, max 7 rows.
// ===========================================================================

function normalizeHost(host) {
  return (host || "").replace(/^www\./, "").toLowerCase();
}

// Dense subsequence fuzzy: every char of needle appears in order in haystack;
// score rewards contiguity + earliness. Returns 0 if no match.
function fuzzyScore(needle, haystack) {
  if (!needle) return 0;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  let hi = 0;
  let score = 0;
  let streak = 0;
  let firstIdx = -1;
  for (let i = 0; i < n.length; i++) {
    const c = n[i];
    let found = -1;
    for (let j = hi; j < h.length; j++) {
      if (h[j] === c) {
        found = j;
        break;
      }
    }
    if (found < 0) return 0; // not a subsequence
    if (firstIdx < 0) firstIdx = found;
    if (found === hi) {
      streak += 1;
      score += 2 + streak; // contiguous run bonus
    } else {
      streak = 0;
      score += 1;
    }
    hi = found + 1;
  }
  // Earliness bonus.
  score += Math.max(0, 6 - firstIdx);
  return score;
}

function logFrecency(item) {
  const visits = (item.visitCount || 0) + (item.typedCount || 0) * 2;
  const recencyDays = item.lastVisitTime ? (Date.now() - item.lastVisitTime) / (24 * 3600 * 1000) : 90;
  const recencyBoost = Math.max(0.4, 1.6 - recencyDays / 60); // ~1.6 fresh → 0.4 old
  return Math.log2(2 + visits) * recencyBoost;
}

function wordBoundaryMatch(text, q) {
  if (!text || !q) return false;
  const re = new RegExp("(^|\\b)" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return re.test(text);
}

async function omniboxSuggest(rawQuery) {
  const q = (rawQuery || "").trim().toLowerCase();
  if (!q) return [];

  const results = await safe(
    chrome.history.search({ text: q, maxResults: 200, startTime: Date.now() - HISTORY_WINDOW_MS }),
    "omnibox history.search"
  );
  const items = results || [];

  const scored = [];
  for (const it of items) {
    let host = "";
    let path = "";
    try {
      const u = new URL(it.url);
      host = normalizeHost(u.host);
      path = u.pathname + u.search;
    } catch (_) {
      continue;
    }
    const title = it.title || "";

    let base = 0;
    if (host.startsWith(q) || normalizeHost(it.url).includes("//" + q)) {
      base = Math.max(base, 1000);
    }
    if (wordBoundaryMatch(title, q) || wordBoundaryMatch(host, q)) base = Math.max(base, 300);
    if (title.toLowerCase().includes(q) || it.url.toLowerCase().includes(q)) base = Math.max(base, 150);
    const fz = fuzzyScore(q, host + " " + title + " " + path);
    if (fz > 0) base = Math.max(base, fz);
    if (base === 0) continue;

    const score = base * logFrecency(it);
    scored.push({ url: it.url, title, host, path, score });
  }

  // Dedupe by host+path (keep highest score).
  const byKey = new Map();
  for (const s of scored) {
    const key = s.host + s.path;
    const prev = byKey.get(key);
    if (!prev || s.score > prev.score) byKey.set(key, s);
  }
  let deduped = Array.from(byKey.values());
  deduped.sort((a, b) => b.score - a.score);

  // ≤3 rows per host, max 7 rows.
  const perHost = new Map();
  const out = [];
  for (const s of deduped) {
    const c = perHost.get(s.host) || 0;
    if (c >= 3) continue;
    perHost.set(s.host, c + 1);
    out.push({
      url: s.url,
      title: s.title || s.host,
      host: s.host,
    });
    if (out.length >= 7) break;
  }
  return out;
}

// ===========================================================================
// ADDRESS NAVIGATION — resolve URL vs. search (search template from context).
// ===========================================================================

function looksLikeUrl(raw) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return "scheme";
  if (/^[^\s]+\.[^\s]+$/.test(raw)) return "domain";
  return false;
}

async function resolveNavigation(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  const ctx = await getContext();
  const template =
    (ctx.searchEngine && ctx.searchEngine.template) || DEFAULT_SEARCH.template;

  if (!raw) return template.replace("%s", "");

  const kind = looksLikeUrl(raw);
  if (kind === "scheme") return raw;
  if (kind === "domain") return "https://" + raw;
  return template.replace("%s", encodeURIComponent(raw));
}

// ===========================================================================
// WHITELIST helpers for context menus.
// ===========================================================================

async function toggleWhitelist(host, add) {
  if (!host) return;
  postToHost({ type: "whitelist-op", op: add ? "add" : "remove", domain: host });
  // Optimistically update the cached context so the menu title flips instantly;
  // the next get-context (port reconnect / stale-refresh) reconciles.
  const ctx = await getContext();
  const wl = new Set((ctx.sleep && ctx.sleep.whitelist) || []);
  if (add) wl.add(host);
  else wl.delete(host);
  ctx.sleep = Object.assign({}, ctx.sleep, { whitelist: Array.from(wl) });
  await storeContext(ctx);
}

// ===========================================================================
// PER-LIL EXPIRY OVERRIDE (hover bar "Keep" menu).
// ===========================================================================

async function setLilExpiry(windowId, expiry) {
  const reg = await getRegistry();
  if (reg[String(windowId)]) {
    reg[String(windowId)].expiry = normalizeExpiry(expiry, "never");
    reg[String(windowId)].lastInteraction = Date.now();
    await setRegistry(reg);
    return true;
  }
  return false;
}

// ===========================================================================
// OVERLAY / COMMAND / SLEEP-PAGE MESSAGE HANDLING
// ===========================================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || typeof msg !== "object") {
        sendResponse({ ok: false });
        return;
      }
      const senderWindowId = sender && sender.tab ? sender.tab.windowId : undefined;
      const senderTabId = sender && sender.tab ? sender.tab.id : undefined;

      switch (msg.action) {
        case "isEphemeral": {
          sendResponse({
            ephemeral: await isEphemeralWindow(senderWindowId),
            incognito: incognitoLils.has(senderWindowId),
          });
          return;
        }
        case "getContext": {
          sendResponse({ context: await getContext() });
          return;
        }
        case "getLilInfo": {
          // Overlay reads the per-lil expiry override for the "Keep" menu.
          const reg = await getRegistry();
          const entry = reg[String(senderWindowId)];
          sendResponse({
            expiry: entry ? entry.expiry : "never",
            incognito: incognitoLils.has(senderWindowId),
          });
          return;
        }
        case "listGroups": {
          const groups = await safe(chrome.tabGroups.query({}), "tabGroups.query");
          const items = (groups || []).map((g) => ({ id: g.id, title: g.title || "", color: g.color || "grey" }));
          sendResponse({ groups: items });
          return;
        }
        case "promote": {
          if (senderTabId === undefined) {
            sendResponse({ ok: false });
            return;
          }
          const ok = await promoteTab(senderTabId, msg.dest || "default", msg.groupId, msg.browser);
          sendResponse({ ok });
          return;
        }
        case "clickHint": {
          recordClickHint(msg.url, msg.meta, msg.ts);
          sendResponse({ ok: true });
          return;
        }
        case "navigate": {
          if (senderTabId === undefined) {
            sendResponse({ ok: false });
            return;
          }
          // Accept either raw user input or a chosen suggestion URL.
          const url = typeof msg.url === "string" && msg.url ? msg.url : await resolveNavigation(msg.input);
          const res = await safe(chrome.tabs.update(senderTabId, { url }), "tabs.update navigate");
          await refreshLastInteraction(senderWindowId);
          sendResponse({ ok: res !== null, url });
          return;
        }
        case "omnibox": {
          const suggestions = await omniboxSuggest(msg.query);
          const ctx = await getContext();
          sendResponse({ suggestions, searchEngine: ctx.searchEngine });
          return;
        }
        case "reload": {
          if (senderTabId !== undefined) await safe(chrome.tabs.reload(senderTabId), "tabs.reload");
          sendResponse({ ok: true });
          return;
        }
        case "interaction": {
          await refreshLastInteraction(senderWindowId);
          sendResponse({ ok: true });
          return;
        }
        case "formDirty": {
          if (senderTabId !== undefined) {
            if (msg.dirty) dirtyTabs.add(senderTabId);
            else dirtyTabs.delete(senderTabId);
          }
          sendResponse({ ok: true });
          return;
        }
        case "setExpiry": {
          const ok = await setLilExpiry(senderWindowId, msg.expiry);
          sendResponse({ ok });
          return;
        }
        case "sleepThisLil": {
          if (senderWindowId !== undefined) await sleepLil(senderWindowId);
          sendResponse({ ok: true });
          return;
        }
        case "reopenIncognito": {
          // Caret-menu "Reopen in incognito lil": open same URL incognito, close current.
          const url = msg.url || (sender && sender.tab ? sender.tab.url : "");
          if (senderWindowId !== undefined) {
            const srcWin = await safe(chrome.windows.get(senderWindowId), "windows.get reopen");
            const left = srcWin && typeof srcWin.left === "number" ? srcWin.left + CASCADE_OFFSET : undefined;
            const top = srcWin && typeof srcWin.top === "number" ? srcWin.top + CASCADE_OFFSET : undefined;
            await openIncognitoLil(url, left, top);
            mruRemove(senderWindowId);
            await deregisterWindow(senderWindowId);
            await safe(chrome.windows.remove(senderWindowId), "windows.remove reopen");
          }
          sendResponse({ ok: true });
          return;
        }
        case "pendingIncognitoHint": {
          // Overlay polls on mount for a one-shot hint (fallback path).
          const has = pendingIncognitoHints.delete(senderWindowId);
          sendResponse({ hint: has });
          return;
        }
        case "wakeLil": {
          // From the sleep page click.
          if (senderWindowId !== undefined) await wakeLil(senderWindowId);
          sendResponse({ ok: true });
          return;
        }
        case "closeWindow": {
          if (senderWindowId !== undefined) {
            mruRemove(senderWindowId);
            const reg = await getRegistry();
            const entry = reg[String(senderWindowId)];
            if (entry && entry.sleepCaptureKey) await safe(idbDelete(entry.sleepCaptureKey), "idb close");
            await deregisterWindow(senderWindowId);
            await safe(chrome.windows.remove(senderWindowId), "windows.remove close");
          }
          sendResponse({ ok: true });
          return;
        }
        default:
          sendResponse({ ok: false });
      }
    } catch (err) {
      log("onMessage error", err && err.message ? err.message : err);
      try {
        sendResponse({ ok: false });
      } catch (_) {
        /* channel already closed */
      }
    }
  })();
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "promote-tab") return;
  const tabs = await safe(chrome.tabs.query({ active: true, lastFocusedWindow: true }), "tabs.query command");
  const tab = tabs && tabs[0];
  if (!tab || tab.windowId === undefined) return;
  if (!(await isEphemeralWindow(tab.windowId))) return;
  await promoteTab(tab.id, "default");
});

// ===========================================================================
// CONTEXT MENUS (v3) — recreated cleanly in onInstalled (removeAll first).
//
// link (lil windows):   Open link in new lil / this lil / incognito lil
// page (lil windows):   Sleep this lil, Never sleep {host} / Allow sleeping {host}
// page (NORMAL windows): Send to lil
// onClicked handlers verify window context and no-op gracefully.
// ===========================================================================

const CTX_NEW_LIL = "open-link-new-lil";
const CTX_SAME_LIL = "open-link-same-lil";
const CTX_INCOGNITO_LIL = "open-link-incognito-lil";
const CTX_SLEEP = "sleep-this-lil";
const CTX_WHITELIST = "toggle-whitelist";
const CTX_SEND_TO_LIL = "send-to-lil";

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    try {
      chrome.contextMenus.create({ id: CTX_NEW_LIL, title: "Open link in new lil", contexts: ["link"] });
      chrome.contextMenus.create({ id: CTX_SAME_LIL, title: "Open link in this lil", contexts: ["link"] });
      chrome.contextMenus.create({
        id: CTX_INCOGNITO_LIL,
        title: "Open link in incognito lil",
        contexts: ["link"],
      });
      chrome.contextMenus.create({ id: CTX_SLEEP, title: "Sleep this lil", contexts: ["page"] });
      chrome.contextMenus.create({ id: CTX_WHITELIST, title: "Never sleep this site", contexts: ["page"] });
      chrome.contextMenus.create({ id: CTX_SEND_TO_LIL, title: "Send to lil", contexts: ["page"] });
    } catch (err) {
      log("contextMenus.create error", err && err.message ? err.message : err);
    }
  });
}

// Keep the whitelist menu title in sync with the active tab's host + lil status.
async function updateContextMenusForTab(tab) {
  if (!tab || tab.windowId === undefined) return;
  const isLil = await isEphemeralWindow(tab.windowId);
  const host = hostOf(tab.url);
  const ctx = await getContext();
  const whitelisted = hostWhitelisted(host, ctx.sleep && ctx.sleep.whitelist);

  const setTitle = (id, title, visible) => {
    chrome.contextMenus.update(id, { title, visible }, () => void chrome.runtime.lastError);
  };

  // Lil-only page items visible in lils; "Send to lil" visible only in normal windows.
  setTitle(CTX_SLEEP, "Sleep this lil", isLil && !incognitoLils.has(tab.windowId));
  setTitle(
    CTX_WHITELIST,
    host ? (whitelisted ? "Allow sleeping " + host : "Never sleep " + host) : "Never sleep this site",
    isLil && !!host
  );
  setTitle(CTX_SEND_TO_LIL, "Send to lil", !isLil);
}

chrome.tabs.onActivated.addListener(async (info) => {
  const tab = await safe(chrome.tabs.get(info.tabId), "tabs.get activated");
  await updateContextMenusForTab(tab);
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab && tab.active) await updateContextMenusForTab(tab);
});
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const tabs = await safe(chrome.tabs.query({ windowId, active: true }), "tabs.query focus menu");
  if (tabs && tabs[0]) await updateContextMenusForTab(tabs[0]);
});

// Re-parent the current NORMAL-window tab into a new lil (Send to lil).
async function sendTabToLil(tabId, srcWindowId) {
  const ctx = await getContext();
  const srcWin = await safe(chrome.windows.get(srcWindowId), "windows.get sendtolil");
  const baseLeft = srcWin && typeof srcWin.left === "number" ? srcWin.left + CASCADE_OFFSET : undefined;
  const baseTop = srcWin && typeof srcWin.top === "number" ? srcWin.top + CASCADE_OFFSET : undefined;
  const size = await getLastSize();
  const clamped = await clampBounds(baseLeft, baseTop, size.width, size.height);

  const opts = { tabId, type: "popup", focused: true, width: clamped.width, height: clamped.height };
  if (clamped.left !== undefined) opts.left = clamped.left;
  if (clamped.top !== undefined) opts.top = clamped.top;

  const win = await safe(chrome.windows.create(opts), "windows.create sendtolil");
  if (win && win.id !== undefined) {
    await focusWindow(win.id);
    mruTouch(win.id);
    const url = (win.tabs && win.tabs[0] && win.tabs[0].url) || "";
    await registerWindow(
      win.id,
      url,
      { left: win.left, top: win.top, width: win.width, height: win.height },
      { expiry: ctx.ephemeralDefault, lastInteraction: Date.now() }
    );
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (!tab || tab.windowId === undefined) return;
    const isLil = await isEphemeralWindow(tab.windowId);

    switch (info.menuItemId) {
      case CTX_NEW_LIL:
        if (isLil && info.linkUrl) await openLinkForLil(tab.windowId, info.linkUrl, "new-lil");
        return;
      case CTX_SAME_LIL:
        if (isLil && info.linkUrl) await openLinkForLil(tab.windowId, info.linkUrl, "same-lil");
        return;
      case CTX_INCOGNITO_LIL:
        if (isLil && info.linkUrl) {
          const srcWin = await safe(chrome.windows.get(tab.windowId), "windows.get ctx incognito");
          const left = srcWin && typeof srcWin.left === "number" ? srcWin.left + CASCADE_OFFSET : undefined;
          const top = srcWin && typeof srcWin.top === "number" ? srcWin.top + CASCADE_OFFSET : undefined;
          await openIncognitoLil(info.linkUrl, left, top);
        }
        return;
      case CTX_SLEEP:
        if (isLil && !incognitoLils.has(tab.windowId)) await sleepLil(tab.windowId);
        return;
      case CTX_WHITELIST: {
        if (!isLil) return;
        const host = hostOf(tab.url);
        if (!host) return;
        const ctx = await getContext();
        const currentlyWhitelisted = hostWhitelisted(host, ctx.sleep && ctx.sleep.whitelist);
        await toggleWhitelist(host, !currentlyWhitelisted);
        await updateContextMenusForTab(tab);
        return;
      }
      case CTX_SEND_TO_LIL:
        if (!isLil && tab.id !== undefined) await sendTabToLil(tab.id, tab.windowId);
        return;
      default:
        return;
    }
  } catch (err) {
    log("contextMenus.onClicked error", err && err.message ? err.message : err);
  }
});

// ===========================================================================
// LIFECYCLE
// ===========================================================================

chrome.runtime.onStartup.addListener(async () => {
  connectNative();
  await ensureSweepAlarm();
  await restoreWindows();
});

chrome.runtime.onInstalled.addListener(async () => {
  connectNative();
  createContextMenus();
  await ensureSweepAlarm();
});

// Top-level: runs on every service-worker wake.
connectNative();
ensureSweepAlarm();
