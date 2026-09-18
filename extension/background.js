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
//   - Focus discipline: per-lil prior context + explicit refocus.
//   - Ephemerality (v3): per-lil expiry + 1-min sweep alarm.
//   - Sleep (v3): captureVisibleTab → IndexedDB → sleep.html; auto + manual.
//   - Incognito lils (v3): gated on isAllowedIncognitoAccess.
//   - Omnibox history suggestions (v3) for the hover bar.
//   - Promote a lil into normal browsing or hand it to another browser.

// LILFOCUS diagnostic seam (issue #30). Inert until armed over the relay; see
// focus-trace.js. Loaded first so its helpers exist for the call sites below.
importScripts("focus-trace.js");

const NATIVE_HOST = "com.lilchromium.relay";
// Registry entry shape (v3):
//   { url, bounds:{left,top,width,height},
//     expiry: "never"|"quit"|<hoursNumber>, lastInteraction: ts,
//     priorContext?: {kind,...},
//     slept?: bool, sleepCaptureKey?: string, originalUrl?: string, originalTitle?: string }
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
const DEFAULT_HOVERBAR = { style: "glass", tint: null, revealHeight: 15 };
const DEFAULT_CONTEXT = {
  browser: "chrome",
  browserName: "Chrome",
  primaryBrowser: "helium",
  primaryBrowserName: "Helium",
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
    // A persisted v0.3 context may still use the legacy keys. Normalize it to
    // the v0.4 contract so no caller needs two browser-identity vocabularies.
    primaryBrowser: src.primaryBrowser || src.defaultBrowser || DEFAULT_CONTEXT.primaryBrowser,
    primaryBrowserName:
      src.primaryBrowserName || src.defaultBrowserName || DEFAULT_CONTEXT.primaryBrowserName,
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
      // Writers clamp to 0..48 before the value leaves the config model
      // (PROTOCOL.md); a non-number here degrades to the default.
      revealHeight:
        typeof hoverBar.revealHeight === "number" && Number.isFinite(hoverBar.revealHeight)
          ? hoverBar.revealHeight
          : DEFAULT_HOVERBAR.revealHeight,
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
// FOCUS DISCIPLINE — live browser focus plus explicit refocus.
//
// WINDOW_ID_NONE is retained as real external-app focus state. Focused lil
// creates are followed by an explicit focusWindow() because
// create({focused:true}) is unreliable on macOS (research §Focus); unfocused
// creates (restoreWindows) skip it.
// ===========================================================================

let focusedWindowId = chrome.windows.WINDOW_ID_NONE;
let lastNormalWindowId = chrome.windows.WINDOW_ID_NONE;
// A worker that wakes while the browser already holds focus must not read
// that focus as "outside the browser": seed both from Chromium unless a focus
// event has already said otherwise.
let focusEventSeen = false;
safe(chrome.windows.getLastFocused({}), "getLastFocused seed").then((win) => {
  if (focusEventSeen || !win || !win.focused) return;
  focusedWindowId = win.id;
  if (win.type === "normal") lastNormalWindowId = win.id;
});

// Teardown reading (issue #31). Chromium removes a closing window's tabs
// first, hands key status to a sibling window, and only then fires
// windows.onRemoved — so `focusedWindowId` at removal already names that
// sibling. tabs.onRemoved is the last event that still sees the closing
// window's own focus; the reading taken there is consumed exactly once by
// windows.onRemoved.
// verified: Helium, issue #30 live trace 2026-08-26 — the handoff
// `focus-changed` preceded `window-removed` in 26/26 focused closes, so a gate
// read at removal said "unfocused" every time.
// A removal that keeps the window open (a Lil Nap wake swap) also writes a
// reading, but the window's last tab is removed before the window is, so the
// reading in force at windows.onRemoved is always the teardown's own.
const teardownFocus = new Map(); // windowId -> held focus when teardown began
// windowId -> Promise<boolean>: whether the teardown restored the lil's prior
// context itself. Taken once per window, so a multi-tab close restores once
// and windows.onRemoved waits for it rather than racing it.
const teardownRestores = new Map();
// Windows Chromium is closing: flagged on their tabs' removal, gone at windows.onRemoved.
const closingWindows = new Set();

// Live tab ids per window, kept from Chromium's tab events so a removal can
// tell synchronously — no query, no storage — that it took the window's last
// tab. Seeded from Chromium for windows that predate this worker; a tab both
// seeded and already seen counts once, and a window this ledger never learned
// reads as never emptied, which only defers its restoration to onRemoved.
// The seed is a snapshot in flight: once a tab has been forgotten it is
// dropped, as it could resurrect that tab as a phantom id.
const windowTabs = new Map(); // windowId -> Set<tabId>
let tabForgotten = false;

function trackTab(windowId, tabId) {
  if (!windowTabs.has(windowId)) windowTabs.set(windowId, new Set());
  windowTabs.get(windowId).add(tabId);
}

// Forget a tab; true when it was the last one the window held.
function untrackTab(windowId, tabId) {
  tabForgotten = true;
  const ids = windowTabs.get(windowId);
  if (!ids) return false;
  ids.delete(tabId);
  if (ids.size) return false;
  windowTabs.delete(windowId);
  return true;
}

safe(chrome.windows.getAll({ populate: true }), "getAll tab ledger seed").then((wins) => {
  if (tabForgotten) return;
  for (const win of wins || []) for (const tab of win.tabs || []) trackTab(win.id, tab.id);
});
chrome.tabs.onCreated.addListener((tab) => trackTab(tab.windowId, tab.id));
chrome.tabs.onAttached.addListener((tabId, info) => trackTab(info.newWindowId, tabId));
chrome.tabs.onDetached.addListener((tabId, info) => untrackTab(info.oldWindowId, tabId));

// Restoring here, while the closing lil is still the key window, keeps the
// key handoff from raising a sibling: once the prior context is in front
// the lil no longer holds key and its removal moves nothing else. A window
// enters teardown on two gestures: Chromium flags the removal
// `isWindowClosing` on the closing paths it knows (red button,
// windows.remove), and ⌘W removes the only tab unflagged, after which the
// emptied window closes on its own — so the last-tab removal is the same
// reading.
// verified: Helium, issue #30 live traces 2026-09-17 and 2026-09-18 —
// isWindowClosing was true in every red-button and windows.remove close and
// false in every ⌘W close; on both gestures the handoff to the primary
// window fired 19–32 ms after tab-removed and, when the restoration waited
// for window-removed, left that window one step below the restored app.
chrome.tabs.onRemoved.addListener((tabId, info) => {
  const heldFocus = focusedWindowId === info.windowId;
  const lastTab = untrackTab(info.windowId, tabId);
  // LILFOCUS: the reading itself, plus both signs of a closing window.
  focusTrace("tab-removed", { tabId, windowId: info.windowId, isWindowClosing: !!info.isWindowClosing, lastTab, heldFocus });
  teardownFocus.set(info.windowId, heldFocus);
  if (!info.isWindowClosing && !lastTab) return;
  closingWindows.add(info.windowId);
  if (unwindsFocus(info.windowId, heldFocus) && !teardownRestores.has(info.windowId)) {
    teardownRestores.set(info.windowId, restoreAtTeardown(info.windowId));
  }
});

// Whether a closing window that held focus gives it back. A successful
// host/group promotion is a transfer, not an unwind.
function unwindsFocus(windowId, heldFocus) {
  return heldFocus && !promotingWindowIds.has(windowId);
}

// Resolves to whether `windowId` was a lil whose prior context was consulted.
// The context is read from memory first so an external-app restoration is
// posted before this function first yields: Chromium orders the closing
// window out and hands key to a sibling while a storage round trip is still
// in flight, and the sibling then shows above the restored app.
// verified: Chromium main components/remote_cocoa/app_shim/
// native_widget_ns_window_bridge.mm CloseWindow() `[window orderOut:nil]`;
// issue-31 trace-2026-09-17T23-20-49-256Z.jsonl, restore-attempt to
// Chromium reporting no focused window in 18–26 ms; 2026-09-18.
async function restoreAtTeardown(windowId) {
  let prior = knownPriorContext(windowId);
  if (prior === undefined) prior = await storedPriorContext(windowId);
  if (prior === undefined) return false;
  await restorePriorContext(prior, "tab-removed");
  return true;
}

// A lil's prior context as this worker holds it in memory: an incognito
// lil's, or the mirror of a registered lil's; undefined for anything else.
function knownPriorContext(windowId) {
  if (incognitoLils.has(windowId)) return incognitoPriorContexts.get(windowId);
  return priorContexts.get(windowId);
}

// A registered lil's prior context from the registry; undefined for anything
// else. The fallback for a lil this worker has not written since it woke.
async function storedPriorContext(windowId) {
  const reg = await getRegistry();
  const entry = reg[String(windowId)];
  return entry ? entry.priorContext : undefined;
}

// LILFOCUS: let the diagnostic seam tell lils from ordinary windows without
// exporting the registry to it.
focusTraceInit({ isLil: (windowId) => isEphemeralWindow(windowId) });

// Focus history (ADR-0004, issue #31). A lil follows ordinary macOS focus
// history as if it were its own app: each time the user brings a registered
// lil forward, its prior context becomes the context they came from — the
// previously focused lil, the previously focused normal window, or the
// external app when Chromium had no focused window. Two kinds of focus change
// are not the user coming from somewhere and leave the history alone:
//   - explicit focus the worker asked for (creation focus, restoration, the
//     same-lil refocus), tracked per window in `explicitFocus`;
//   - Chromium's key handoff to a sibling when a focused window closes, which
//     on macOS arrives before that window's onRemoved. The handoff is only
//     recognisable once onRemoved follows, so the latest transfer remembers
//     what it overwrote and onRemoved puts it back (revertHandoffFrom).
const explicitFocus = new Set(); // window ids whose next focus event is the worker's doing
const everFocused = new Set(); // window ids that have had a focus event (creation focus included)
let lastTransfer = null; // { to, from, displaced: Promise<prior context the record replaced> } for the latest focus event

// Explicit focus. Used after windows.create when a lil is asked to take focus.
// A window Chromium already reports focused raises no event for the update,
// so it is not marked: the mark would outlive the update and swallow the
// user's next genuine focus of that window.
async function focusWindow(windowId) {
  if (typeof windowId !== "number") return;
  if (focusedWindowId !== windowId) explicitFocus.add(windowId);
  const win = await safe(chrome.windows.update(windowId, { focused: true }), "windows.update focus");
  if (!win) explicitFocus.delete(windowId);
}

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  focusEventSeen = true;
  const previous = focusedWindowId;
  focusedWindowId = windowId;
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    endTransferUnlessHandoff();
    focusTrace("focus-changed", { windowId, kind: "none" });
    return;
  }
  // Decided synchronously: a handoff's onRemoved may run before any await here resumes.
  everFocused.add(windowId);
  const skipHistory = explicitFocus.delete(windowId) || previous === windowId;
  if (skipHistory) endTransferUnlessHandoff();
  else lastTransfer = { to: windowId, from: previous, displaced: recordFocusHistory(windowId, previous) };
  const win = await safe(chrome.windows.get(windowId), "windows.get last-normal");
  focusTrace("focus-changed", async () => ({
    windowId,
    kind: win ? win.type : "gone",
    isLil: await isEphemeralWindow(windowId),
  }));
  if (win && win.type === "normal" && focusedWindowId === windowId) {
    lastNormalWindowId = windowId;
  }
});

// A focus event that records no history ends the latest transfer, except a
// key handoff from a window mid-teardown, which onRemoved has yet to revert:
// the prior context restored at tab-removed can bring another window or app
// forward before Chromium reports the closing window gone.
function endTransferUnlessHandoff() {
  if (lastTransfer && !closingWindows.has(lastTransfer.from)) lastTransfer = null;
}

// The context a lil came from when the user brought it forward. Non-lil popups
// (OAuth windows, DevTools) are transient and leave the history untouched.
async function priorContextOf(previousWindowId) {
  if (previousWindowId === chrome.windows.WINDOW_ID_NONE) return { kind: "external-app" };
  if (await isEphemeralWindow(previousWindowId)) return { kind: "lil", windowId: previousWindowId };
  const win = await safe(chrome.windows.get(previousWindowId), "windows.get prior context");
  return win && win.type === "normal" ? { kind: "normal-window", windowId: previousWindowId } : undefined;
}

// Resolves to the prior context this write replaced (see setPriorContext).
async function recordFocusHistory(windowId, previousWindowId) {
  const prior = await priorContextOf(previousWindowId);
  return prior === undefined ? undefined : setPriorContext(windowId, prior);
}

// Put back the prior context a key handoff from `closingWindowId` overwrote.
async function revertHandoffFrom(closingWindowId) {
  const transfer = lastTransfer;
  if (!transfer || transfer.from !== closingWindowId) return;
  lastTransfer = null;
  const displaced = await transfer.displaced;
  if (displaced !== undefined) await setPriorContext(transfer.to, displaced);
}

// Write a lil's prior context; returns the value it replaced, or undefined
// when `windowId` is not a lil.
async function setPriorContext(windowId, prior) {
  if (incognitoLils.has(windowId)) {
    const overwrote = incognitoPriorContexts.get(windowId) || null;
    incognitoPriorContexts.set(windowId, prior);
    return overwrote;
  }
  const reg = await getRegistry();
  const entry = reg[String(windowId)];
  if (!entry) return undefined;
  const overwrote = normalizePriorContext(entry.priorContext);
  entry.priorContext = prior;
  priorContexts.set(windowId, prior);
  await setRegistry(reg);
  return overwrote;
}

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
      focusTrace("open-request", {
        url: msg.url,
        left: msg.left,
        top: msg.top,
        incognito: !!msg.incognito,
        appSuppliedPriorContext: normalizePriorContext(msg.priorContext),
      });
      if (msg.incognito) {
        await openIncognitoLil(msg.url, msg.left, msg.top, msg.priorContext);
      } else {
        await openLil({ url: msg.url, left: msg.left, top: msg.top, appSuppliedPriorContext: msg.priorContext });
      }
    } else if (msg.type === "history-query") {
      await answerHistoryQuery(msg);
    } else if (msg.type === "context") {
      await storeContext(msg);
      // Reconnect catch-up (issue #12): a fresh host-sourced context also
      // converges the lils that missed a config-update while disconnected.
      await broadcastContextToLils();
      log(
        "context updated",
        "browser=" + msg.browser,
        "primary=" + msg.primaryBrowser,
        "link=" + msg.linkBehavior
      );
    } else if (msg.type === "config-update") {
      await applyConfigUpdate(msg);
    } else if (focusTraceControl(msg)) {
      // LILFOCUS: arm/disarm/snapshot for the issue #30 focus loop.
    } else {
      log("unknown port message", msg.type);
    }
  } catch (err) {
    log("handlePortMessage error", err && err.message ? err.message : err);
  }
}

// Hot-apply (issue #12): the app published the normalized full config to every
// relay. Replace the config half of the cached context — the host identity
// (browser/browserName) is this worker's own, not the app's — then push the
// result to every live lil so overlays apply it without a reload.
async function applyConfigUpdate(msg) {
  const current = await getContext();
  await storeContext({ ...msg, browser: current.browser, browserName: current.browserName });
  await broadcastContextToLils();
  log("config hot-applied", "primary=" + msg.primaryBrowser, "link=" + msg.linkBehavior);
}

// Push the current context to every live lil's overlay (registered lils plus
// in-memory incognito ones). Fire-and-forget per lil: a tab mid-navigation
// misses the push but reads fresh context when its overlay mounts.
async function broadcastContextToLils() {
  const ctx = await getContext();
  const reg = await getRegistry();
  const windowIds = new Set(
    Object.keys(reg)
      .map((key) => parseInt(key, 10))
      .filter((id) => Number.isInteger(id))
  );
  for (const id of incognitoLils) windowIds.add(id);
  for (const windowId of windowIds) {
    await broadcastToWindow(windowId, { action: "contextUpdate", context: ctx });
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
  priorContexts.set(windowId, reg[String(windowId)].priorContext);
  await setRegistry(reg);
}

async function deregisterWindow(windowId) {
  priorContexts.delete(windowId);
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
  return isRegisteredLil(windowId);
}

async function isRegisteredLil(windowId) {
  if (windowId === undefined || windowId === null) return false;
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
// LIL LIFECYCLE — the one boundary every lil is born through.
//
// Creation, placement, focus, and registration are a single policy here, so the
// five entry paths (app-requested open, incognito open, cascaded tab, Send to
// lil, restart restoration) differ only in the spec they hand in. Nothing is
// registered until Chromium confirms a window id, so a failure at any step
// cannot leave a registry entry for a window that does not exist.
// ===========================================================================

const incognitoLils = new Set(); // window ids of live incognito lils
const incognitoPriorContexts = new Map(); // window id -> prior context
// window id -> prior context, mirroring the registry entry of every lil this
// worker registered, remapped, or rewrote, so a teardown reads it without a
// storage round trip. A woken worker's registry is the fallback (knownPriorContext).
const priorContexts = new Map();
// Host/group promotion empties the source lil and Chrome removes that window.
// That onRemoved is a lifecycle transfer, not a close/unwind.
const promotingWindowIds = new Set();

function normalizePriorContext(value) {
  if (!value || typeof value !== "object") return null;
  if ((value.kind === "lil" || value.kind === "normal-window") && Number.isInteger(value.windowId)) {
    return { kind: value.kind, windowId: value.windowId };
  }
  if (value.kind === "external-app") {
    // Without a pid the external app is whichever one the user came from;
    // only the host's activation history knows it (PROTOCOL restore-focus).
    const context = { kind: "external-app" };
    if (Number.isInteger(value.pid) && value.pid > 0) {
      context.pid = value.pid;
      if (typeof value.bundleId === "string" && value.bundleId) context.bundleId = value.bundleId;
    }
    return context;
  }
  return null;
}

// Capture the live Chromium focus before windows.create can change it. When no
// browser window is focused, only the app-supplied prior-context candidate is
// eligible.
async function capturePriorContext(appSuppliedPriorContext) {
  const all = await safe(chrome.windows.getAll({}), "getAll prior context");
  // LILFOCUS: this reading is the live Chromium focus state the choice below
  // turns on, taken from the array the capture already holds so tracing adds
  // no query and no await to the create path.
  focusTrace("prior-context-capture", {
    appSuppliedPriorContext: normalizePriorContext(appSuppliedPriorContext),
    windows: (all || []).map((win) => ({
      id: win.id,
      type: win.type,
      focused: !!win.focused,
      incognito: !!win.incognito,
      bounds: { left: win.left, top: win.top, width: win.width, height: win.height },
    })),
  });
  const focused = (all || []).find((win) => win.focused && win.id !== undefined);
  if (focused) {
    if (await isEphemeralWindow(focused.id)) return { kind: "lil", windowId: focused.id };
    return focused.type === "normal" ? { kind: "normal-window", windowId: focused.id } : null;
  }
  const normalized = normalizePriorContext(appSuppliedPriorContext);
  return normalized && normalized.kind === "external-app" ? normalized : null;
}

// `at` names the teardown event the restoration runs from (LILFOCUS only).
async function restorePriorContext(priorContext, at) {
  const prior = normalizePriorContext(priorContext);
  if (!prior) {
    focusTrace("restore-attempt", { at, priorContext: null, outcome: "no-predecessor" });
    return;
  }

  if (prior.kind === "external-app") {
    const delivered = postToHost({ type: "restore-focus", priorContext: prior });
    focusTrace("restore-attempt", { at, priorContext: prior, outcome: delivered ? "sent-to-host" : "host-unavailable" });
    return;
  }

  const win = await safe(chrome.windows.get(prior.windowId), "windows.get prior context");
  if (!win) {
    focusTrace("restore-attempt", { at, priorContext: prior, outcome: "stale-window" });
    return;
  }
  if (prior.kind === "lil" && !(await isEphemeralWindow(prior.windowId))) {
    focusTrace("restore-attempt", { at, priorContext: prior, outcome: "no-longer-a-lil" });
    return;
  }
  if (prior.kind === "normal-window" && win.type !== "normal") {
    focusTrace("restore-attempt", { at, priorContext: prior, outcome: "no-longer-normal" });
    return;
  }
  focusTrace("restore-attempt", { at, priorContext: prior, outcome: "focus-window" });
  await focusWindow(prior.windowId);
}

/**
 * Open one lil and bring it into the lifecycle. Returns the created window, or
 * null if creation failed.
 *
 * spec:
 *   url          URL for a fresh lil. Omit when adopting an existing tab.
 *   tabId        Existing tab to adopt into the new lil.
 *   left, top    Desired top-left before clamping; undefined centers the lil.
 *   size         {width, height}; defaults to the remembered last user size.
 *   focus        Ask for focus after create (default true).
 *   incognito    In-memory-only lil: never registered, never restored.
 *   priorContext Explicit related lil/normal-window the focus history starts from.
 *   appSuppliedPriorContext App-supplied prior-context candidate, eligible
 *                only when Chromium has no focused window.
 *   recordUrl    URL to store in the registry. Defaults to `url`, then the
 *                adopted tab's URL — restoration uses it so a slept lil records
 *                its real URL rather than its sleep-page URL.
 *   registration Registry fields layered over the defaults (expiry seeded from
 *                the host's ephemeralDefault, lastInteraction stamped now).
 */
async function openLil(spec) {
  const adopting = spec.tabId !== undefined;
  if (!adopting && (typeof spec.url !== "string" || !spec.url)) {
    log("openLil: missing url");
    return null;
  }

  const priorContext =
    spec.priorContext !== undefined
      ? normalizePriorContext(spec.priorContext)
      : await capturePriorContext(spec.appSuppliedPriorContext);
  const size = spec.size || (await getLastSize());
  const bounds = await clampBounds(spec.left, spec.top, size.width, size.height);
  const focus = spec.focus !== false;

  focusTrace("lil-create-begin", {
    url: spec.url,
    adopting,
    focusRequested: focus,
    appSuppliedPriorContext: normalizePriorContext(spec.appSuppliedPriorContext),
    chosenPriorContext: priorContext,
    chosenBy: spec.priorContext !== undefined ? "caller" : "live-focus-capture",
  });

  const opts = { type: "popup", focused: focus, width: bounds.width, height: bounds.height };
  if (adopting) opts.tabId = spec.tabId;
  else opts.url = spec.url;
  if (spec.incognito) opts.incognito = true;
  if (bounds.left !== undefined) opts.left = bounds.left;
  if (bounds.top !== undefined) opts.top = bounds.top;

  const win = await safe(chrome.windows.create(opts), "windows.create lil");
  if (!win || win.id === undefined) {
    focusTrace("lil-create-failed", { url: spec.url });
    return null;
  }

  // The creation focus event is the worker's doing whichever side of this
  // line it lands on; if it is still to come, mark it so it keeps the
  // creation-time prior context chosen above.
  if (focus && !everFocused.has(win.id)) explicitFocus.add(win.id);

  focusTraceLilCreated(win.id, {
    windowId: win.id,
    focusRequested: focus,
    createdFocused: !!win.focused,
    bounds: { left: win.left, top: win.top, width: win.width, height: win.height },
    priorContext,
  });

  if (focus) {
    // Explicit refocus (create({focused:true}) unreliable when not frontmost).
    await focusWindow(win.id);
  }

  // Incognito lils live in memory only: never persisted, never restored.
  if (spec.incognito) {
    incognitoLils.add(win.id);
    if (priorContext) incognitoPriorContexts.set(win.id, priorContext);
    if (focus) await refreshMenusForWindow(win);
    return win;
  }

  const ctx = await getContext();
  await registerWindow(
    win.id,
    spec.recordUrl || spec.url || (win.tabs && win.tabs[0] && win.tabs[0].url) || "",
    { left: win.left, top: win.top, width: win.width, height: win.height },
    Object.assign(
      { expiry: ctx.ephemeralDefault, lastInteraction: Date.now(), priorContext },
      spec.registration
    )
  );
  if (focus) await refreshMenusForWindow(win);
  return win;
}

async function refreshMenusForWindow(win) {
  const tab = win && win.tabs && win.tabs[0];
  if (tab) await updateContextMenusForTab(tab);
}

// Top-left for a lil cascaded off `windowId`. `unpositionedCoord` is used per
// axis when the source window has no position — undefined lets clampBounds
// center instead.
async function cascadeOrigin(windowId, unpositionedCoord) {
  const src = await safe(chrome.windows.get(windowId), "windows.get cascade origin");
  const offset = (v) => (typeof v === "number" ? v + CASCADE_OFFSET : unpositionedCoord);
  return { left: offset(src && src.left), top: offset(src && src.top) };
}

// ===========================================================================
// INCOGNITO LILS (v3).
//
// Gated on isAllowedIncognitoAccess(); if off, fall back to a NORMAL lil and
// tell the content overlay to show a hint toast pointing at the toggle.
// ===========================================================================

async function openIncognitoLil(url, left, top, appSuppliedPriorContext) {
  if (typeof url !== "string" || !url) return null;
  // A normal lil whose overlay surfaces the incognito-toggle hint.
  const fallback = async () => {
    const win = await openLil({ url, left, top, appSuppliedPriorContext });
    if (win) queueIncognitoHint(win.id);
    return win;
  };
  const allowed = await safe(chrome.extension.isAllowedIncognitoAccess(), "isAllowedIncognitoAccess");
  if (!allowed) return fallback();
  // A failed create means the toggle raced off (or worse) → normal fallback.
  return (await openLil({ url, left, top, incognito: true, appSuppliedPriorContext })) || fallback();
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
// reopen as their nap page.
// ===========================================================================

async function restoreWindows() {
  const oldReg = await getRegistry();
  const entries = Object.entries(oldReg);
  if (!entries.length) return;

  priorContexts.clear();
  await setRegistry({});

  // Nap pages are rebuilt with the current configured tint; the normalized
  // context already carries the built-in default when configuration has none.
  const ctx = await getContext();
  const tint = ctx.sleep && ctx.sleep.tint ? ctx.sleep.tint : DEFAULT_SLEEP.tint;

  let restored = 0;
  const restoredWindowIds = new Map();
  for (const [oldWindowId, entry] of entries) {
    if (!entry || typeof entry.url !== "string" || !entry.url) continue;
    if (entry.expiry === "quit") continue; // excluded from restore

    const b = entry.bounds || {};
    // Slept lils reopen straight to their sleep page (screenshot still in IDB).
    const slept = entry.slept && entry.sleepCaptureKey && entry.originalUrl;

    const win = await openLil({
      url: slept
        ? sleepPageUrl({
            captureKey: entry.sleepCaptureKey,
            originalUrl: entry.originalUrl,
            originalTitle: entry.originalTitle,
            tint,
          })
        : entry.url,
      recordUrl: entry.url,
      left: b.left,
      top: b.top,
      size: { width: b.width || DEFAULT_SIZE.width, height: b.height || DEFAULT_SIZE.height },
      focus: false, // restoration must never steal focus from the user
      priorContext: null, // never derive a predecessor from incidental startup focus
      registration: {
        expiry: normalizeExpiry(entry.expiry, "never"),
        lastInteraction: Date.now(),
        priorContext: normalizePriorContext(entry.priorContext),
        slept: !!entry.slept,
        sleepCaptureKey: entry.sleepCaptureKey,
        originalUrl: entry.originalUrl,
        originalTitle: entry.originalTitle,
      },
    });
    if (win) {
      restored += 1;
      restoredWindowIds.set(oldWindowId, win.id);
    }
  }

  // Restored Chromium window ids are new. Re-key predecessor-lil references
  // after every window exists so chain order in storage cannot matter.
  const reg = await getRegistry();
  let remapped = false;
  for (const [key, entry] of Object.entries(reg)) {
    const prior = normalizePriorContext(entry && entry.priorContext);
    if (!prior || prior.kind !== "lil") continue;
    const newWindowId = restoredWindowIds.get(String(prior.windowId));
    entry.priorContext = newWindowId === undefined ? null : { kind: "lil", windowId: newWindowId };
    priorContexts.set(Number(key), entry.priorContext);
    remapped = true;
  }
  if (remapped) await setRegistry(reg);
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
    // If the active, user-visible document has left the nap URL (page fallback
    // whose own cleanup hung), finish the leftover registry/capture work.
    // An inactive same-window wake preload reporting the original URL is not
    // a completed wake and must not clear nap state; neither is the fresh
    // document of a swap that still has a nap document to fall back to.
    if (reg[key].slept) {
      if (tab.active && !isSleepPageUrl(changeInfo.url) && !(await napDocumentMayRemain(tab.windowId))) {
        await clearNapState(
          tab.windowId,
          reg[key].originalUrl || changeInfo.url,
          reg[key].sleepCaptureKey
        );
      }
      return;
    }
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
  const incognitoPriorContext = incognitoPriorContexts.get(windowId);
  incognitoPriorContexts.delete(windowId);
  const wasIncognito = incognitoLils.delete(windowId);
  const reg = await getRegistry();
  const entry = reg[String(windowId)];
  const wasLil = !!entry || wasIncognito;

  const wasFocused = teardownFocus.has(windowId) ? teardownFocus.get(windowId) : focusedWindowId === windowId;
  teardownFocus.delete(windowId);
  const teardownRestore = teardownRestores.get(windowId);
  teardownRestores.delete(windowId);
  closingWindows.delete(windowId);
  windowTabs.delete(windowId);
  everFocused.delete(windowId);
  explicitFocus.delete(windowId);
  if (focusedWindowId === windowId) focusedWindowId = chrome.windows.WINDOW_ID_NONE;

  const promoting = promotingWindowIds.has(windowId);
  focusTrace("window-removed", {
    windowId,
    wasLil,
    wasFocused,
    promoting,
    priorContext: normalizePriorContext(entry ? entry.priorContext : incognitoPriorContext),
  });

  await revertHandoffFrom(windowId);

  // Consult the prior context exactly once, before deleting the lil's state,
  // unless the teardown already did.
  const restoredEarly = (await teardownRestore) === true;
  if (wasLil && unwindsFocus(windowId, wasFocused) && !restoredEarly) {
    await restorePriorContext(entry ? entry.priorContext : incognitoPriorContext, "window-removed");
  }

  // Clean up any stored capture for this lil.
  if (entry && entry.sleepCaptureKey) {
    await safe(idbDelete(entry.sleepCaptureKey), "idb delete onRemoved");
  }
  await deregisterWindow(windowId);

});

// ===========================================================================
// NEW-WINDOW LINK HANDLING (v3, classification refined in v4 by issue #16).
//
// On onCreatedNavigationTarget from a lil, WAIT for the tab to settle, then:
//   - window.type === "popup" OR OAuth-guard URL (requested or settled)
//       → do NOTHING (preserve the native popup/auth flow: window.opener /
//         postMessage). A missing openerTabId alone is NOT decisive: a
//         rel="noopener" target=_blank spawn is a genuine requested target.
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

// Cascade an existing tab into its own offset lil. A source window with
// no position cascades off the origin, so the lil still lands offset.
async function cascadeTabToLil(tabId, srcWindowId, fallbackUrl) {
  const { left, top } = await cascadeOrigin(srcWindowId, CASCADE_OFFSET);
  return openLil({
    tabId,
    recordUrl: fallbackUrl,
    left,
    top,
    priorContext: { kind: "lil", windowId: srcWindowId },
  });
}

// Tabs named by webNavigation.onCreatedNavigationTarget. That event is the
// public signal that a tab was created to host a navigation from another tab,
// so the new-window link flow owns it — the new-tab conversion below must
// never adopt it, regardless of which listener runs first (Chromium dispatches
// tabs.onCreated for the new tab before this event). Command+T / utility opens
// never fire it. Claimed synchronously at listener entry so the claim always
// lands before the new-tab flow's settle-then-decide checks; tab ids are
// session-unique, so entries are kept for the life of the service worker.
const linkOwnedTabIds = new Set();

chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  if (details && typeof details.tabId === "number") linkOwnedTabIds.add(details.tabId);
  try {
    const srcTab = await safe(chrome.tabs.get(details.sourceTabId), "tabs.get source");
    if (!srcTab || srcTab.windowId === undefined) return;
    if (!(await isEphemeralWindow(srcTab.windowId))) return;

    // WAIT for the spawned tab to settle before deciding (race is real).
    const settled = await settleTabAndWindow(details.tabId);
    if (!settled) return; // tab vanished — nothing to do
    const { tab, win } = settled;

    // ---- Branch 1: native popup / guarded auth flow → LEAVE UNTOUCHED. ----
    // Preservation is decided by the settled state together: a genuine popup
    // window (a featureful window.open keeps window.opener/postMessage alive)
    // or an OAuth-guard URL, requested or final. A missing opener alone is
    // NOT decisive (issue #16): an opener-less spawn in a normal window is a
    // genuine requested browsing target and follows the configured behavior.
    const isPopupWindow = win.type === "popup";
    const authUrl = matchesOAuthGuard(details.url) || matchesOAuthGuard(tab.url);
    if (isPopupWindow || authUrl) {
      log("new-window: preserving native popup/auth", win.type, "opener=" + tab.openerTabId);
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
// NEW-TAB CONVERSION (v4, issue #18).
//
// A browser-created tab (Command+T, or a utility open targeted at this
// browser) converts into a lil only when public events tie it to a lil:
// onFocusChanged still names a registered lil at the onCreated event, the
// tab is active and opener-less, and it landed in an already-populated
// normal window. No timestamps. When that tie is missing, leave the tab.
// A tab claimed by the link flow (linkOwnedTabIds) or matching the OAuth
// guard is never converted — the new-window leave-alone rules always win.
// ===========================================================================

chrome.tabs.onCreated.addListener(async (tab) => {
  const sourceWindowId = focusedWindowId;
  const destWindowId = lastNormalWindowId;
  try {
    if (!tab || tab.id === undefined || tab.windowId === undefined) return;
    if (tab.active !== true) return;
    if (tab.openerTabId !== undefined && tab.openerTabId !== null) return;
    if (sourceWindowId === chrome.windows.WINDOW_ID_NONE) return;
    if (tab.windowId === sourceWindowId) return;
    if (tab.windowId !== destWindowId) return;
    if (!(await isEphemeralWindow(sourceWindowId))) return;

    const settled = await settleTabAndWindow(tab.id);
    if (!settled) return;
    const { tab: live, win } = settled;
    if (linkOwnedTabIds.has(tab.id)) return;
    if (live.openerTabId !== undefined && live.openerTabId !== null) return;
    if (matchesOAuthGuard(live.url || live.pendingUrl)) return;
    if (live.active !== true) return;
    if (!win || win.type !== "normal") return;
    if (await isEphemeralWindow(win.id)) return;

    const inWindow = await safe(
      chrome.tabs.query({ windowId: live.windowId }),
      "tabs.query new-tab siblings"
    );
    if (!inWindow || inWindow.filter((t) => t.id !== live.id).length === 0) return;

    await cascadeTabToLil(
      live.id,
      sourceWindowId,
      live.url || live.pendingUrl || tab.url || tab.pendingUrl || ""
    );
  } catch (err) {
    log("new-tab conversion error", err && err.message ? err.message : err);
  }
});

// ===========================================================================
// SLEEP SYSTEM (v3).
//
// Pipeline: captureVisibleTab (throttled ≤2/sec) → dataURL→Blob→IndexedDB →
// mark registry {slept, sleepCaptureKey, originalUrl, originalTitle} →
// replace the tab document with sleep.html. Wake (v4, issue #21): sleep page
// click → wakeLil → the original URL loads in an inactive tab of the same lil
// window behind the nap image; after the 180 ms floor (readiness-gated, 500 ms
// cap) the fresh tab takes over, the nap tab is removed, and the capture and
// nap registry fields are cleared. A preload whose windowId is not the lil
// is dropped; wake then replaces in place so the lil is not emptied.
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

// Build the sleep-page URL from the nap-page inputs. Capture identity,
// original URL/title, and tint travel as one named value so none can shift or
// be silently omitted between entry and restore. Wire params (k/u/t/tint) and
// the sleep.html page name are unchanged.
function sleepPageUrl({ captureKey, originalUrl, originalTitle, tint }) {
  const params = new URLSearchParams();
  params.set("k", captureKey);
  params.set("u", originalUrl || "");
  params.set("t", originalTitle || "");
  if (tint) params.set("tint", tint);
  return chrome.runtime.getURL("sleep.html") + "?" + params.toString();
}

function isSleepPageUrl(url) {
  if (typeof url !== "string" || !url) return false;
  const nap = chrome.runtime.getURL("sleep.html");
  return url === nap || url.startsWith(nap + "?");
}

// Might a nap document still exist anywhere in this lil window? Nap state is
// only leftover once none does: while one remains — a wake swap still in
// flight, a rollback that put it back in front — the registry is telling the
// truth. Asked at the moment of clearing, so a stale event cannot act on a
// window that has since changed. An unanswerable query counts as "may remain":
// clearing on a guess would delete a capture the nap still needs, while
// keeping it costs only a later event or the sweep's orphan pass.
async function napDocumentMayRemain(windowId) {
  const tabs = await safe(chrome.tabs.query({ windowId }), "tabs.query nap leftover");
  return !tabs || tabs.some((t) => isSleepPageUrl(t.url) || isSleepPageUrl(t.pendingUrl));
}

// Release the original document by replacing the current history entry so the
// nap URL does not sit on top of the live page in back/forward. Replacement is
// the only truthful release: when scripting is unavailable or fails, return
// false and leave the live document untouched — never degrade to
// history-pushing navigation.
async function replaceTabDocument(tabId, url) {
  const execute = chrome.scripting && chrome.scripting.executeScript;
  if (typeof execute !== "function") return false;
  const injected = await safe(
    execute.call(chrome.scripting, {
      target: { tabId },
      func: (nextUrl) => {
        location.replace(nextUrl);
      },
      args: [url],
    }),
    "scripting.executeScript replace"
  );
  return !!injected;
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
  const originalTitle = typeof tab.title === "string" ? tab.title : "";
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
    reg2[String(windowId)].originalTitle = originalTitle;
    await setRegistry(reg2);
  }

  const released = await replaceTabDocument(
    tab.id,
    sleepPageUrl({ captureKey, originalUrl, originalTitle, tint })
  );
  if (!released) {
    // The live document was never released, so the nap never happened: roll
    // back this entry's nap-only registry fields and the freshly stored
    // capture rather than claim a nap the user cannot see.
    const reg3 = await getRegistry();
    const pending = reg3[String(windowId)];
    if (pending && pending.sleepCaptureKey === captureKey) {
      delete pending.slept;
      delete pending.sleepCaptureKey;
      delete pending.originalUrl;
      delete pending.originalTitle;
      await setRegistry(reg3);
    }
    await safe(idbDelete(captureKey), "idbDelete nap rollback");
    log("sleepLil: document replacement failed for", windowId);
    return false;
  }
  log("slept lil", windowId);
  return true;
}

// Wake timing bounds (issue #21): the static nap image stays visible for at
// least 180 ms, the swap completes as soon as the fresh page is ready after
// that floor, and waiting for readiness stops no later than 500 ms.
const WAKE_MIN_HOLD_MS = 180;
const WAKE_MAX_WAIT_MS = 500;

// Milliseconds until the wake image floor is met, never negative. The one
// timing rule for both the preload waiter and the replacement-fallback path.
function wakeFloorRemainingMs(startedAt) {
  return Math.max(0, startedAt + WAKE_MIN_HOLD_MS - Date.now());
}

// Wait until the wake swap may happen for the preloaded tab: the fresh page's
// first `status: "complete"` held to the 180 ms image floor, or the 500 ms cap
// if readiness never arrives — the transition proceeds regardless.
function waitForWakeSwap(tabId, startedAt) {
  return new Promise((resolve) => {
    let done = false;
    let floorTimer = null;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (floorTimer !== null) clearTimeout(floorTimer);
      clearTimeout(capTimer);
      resolve();
    };
    // Readiness observed: swap at once past the floor, else when it is met.
    const ready = () => {
      if (done || floorTimer !== null) return; // readiness already observed
      const wait = wakeFloorRemainingMs(startedAt);
      if (wait === 0) finish();
      else floorTimer = setTimeout(finish, wait);
    };
    const onUpdated = (id, changeInfo) => {
      if (id !== tabId || !changeInfo || changeInfo.status !== "complete") return;
      ready();
    };
    const capTimer = setTimeout(finish, Math.max(0, startedAt + WAKE_MAX_WAIT_MS - Date.now()));
    chrome.tabs.onUpdated.addListener(onUpdated);
    // Subscribed first, so readiness cannot fall between the listener and this
    // inspection: a load that already completed still swaps at the floor.
    void safe(chrome.tabs.get(tabId), "tabs.get wake readiness").then((tab) => {
      if (tab && tab.status === "complete") ready();
    });
  });
}

// Clear every nap-only registry field while keeping the lil registered, and
// delete the stored capture. Used after a successful wake replacement, and as
// the event-driven backstop when the nap document is already gone.
async function clearNapState(windowId, originalUrl, captureKey) {
  const reg = await getRegistry();
  const entry = reg[String(windowId)];
  if (entry) {
    delete entry.slept;
    delete entry.sleepCaptureKey;
    delete entry.originalUrl;
    delete entry.originalTitle;
    entry.url = originalUrl;
    entry.lastInteraction = Date.now();
    await setRegistry(reg);
  }
  if (captureKey) await safe(idbDelete(captureKey), "idbDelete wake");
}

// A wake preload is usable only when it actually sits in the napping lil.
// A missing id, or a tab whose windowId is not the lil, is not a same-lil
// preload — activating it and removing the nap tab would relocate the URL
// and close the lil (issue #33 / #21 F4).
// verified: Helium 0.15.7.1, 2026-08-25: waking the napping lil closed
// window 110440991 and left the original URL as a new tab in Primary
// 110440584 (windows 2→1, original-URL tabs 1→2). tabs.create request/
// return ids and registry were not captured in the worker.
function wakePreloadIsInLil(tab, windowId) {
  return !!(tab && tab.id !== undefined && tab.windowId === windowId);
}

// Wake a slept lil through a bounded, clean transition. The original URL
// begins loading at once in an inactive tab of the same lil window while the
// nap image stays painted; once the fresh page is ready (never before the
// 180 ms floor, never waiting past 500 ms) the fresh tab takes over and the
// nap tab — and with it the internal nap history entry — is removed. Success
// is reported only after that replacement has actually happened; failures
// leave nap state truthful so the nap page's own fallback can fire.
async function wakeLil(windowId) {
  const reg = await getRegistry();
  const entry = reg[String(windowId)];
  if (!entry) return false;
  const originalUrl = entry.originalUrl || entry.url;
  const captureKey = entry.sleepCaptureKey;
  if (!originalUrl) return false;

  const tabs = await safe(chrome.tabs.query({ windowId, active: true }), "tabs.query wake");
  const napTab = tabs && tabs[0];
  if (!napTab || napTab.id === undefined) return false;

  const startedAt = Date.now();
  const freshTab = await safe(
    chrome.tabs.create({ windowId, url: originalUrl, active: false }),
    "tabs.create wake"
  );

  if (!wakePreloadIsInLil(freshTab, windowId)) {
    // Preload missing or relocated: drop a misplaced tab so the original URL
    // does not survive outside the lil, then hold the image floor and release
    // the nap document through entry's replacement-only path. Never remove the
    // nap tab on this path — that would empty and close the lil. If the drop
    // fails, the original URL still sits outside the lil: do not replace in
    // place, clear nap state, or report success.
    if (freshTab && freshTab.id !== undefined) {
      try {
        await chrome.tabs.remove(freshTab.id);
      } catch (err) {
        log("wakeLil: misplaced preload cleanup failed for", windowId, err && err.message ? err.message : err);
        return false;
      }
    }
    const wait = wakeFloorRemainingMs(startedAt);
    if (wait > 0) await delay(wait);
    const released = await replaceTabDocument(napTab.id, originalUrl);
    if (!released) {
      log("wakeLil: no fresh navigation possible for", windowId);
      return false;
    }
    await clearNapState(windowId, originalUrl, captureKey);
    log("woke lil", windowId, "(replacement fallback)");
    return true;
  }

  await waitForWakeSwap(freshTab.id, startedAt);

  // Wake completes only when a fresh active document has actually replaced
  // the nap document. Until then nap state stays truthful and the reply
  // reports failure, so the nap page's own fallback can fire.
  const activated = await safe(chrome.tabs.update(freshTab.id, { active: true }), "tabs.update wake activate");
  if (!activated) {
    await safe(chrome.tabs.remove(freshTab.id), "tabs.remove wake preload");
    log("wakeLil: fresh tab activation failed for", windowId);
    return false;
  }
  try {
    await chrome.tabs.remove(napTab.id);
  } catch (err) {
    // The nap document survived: put it back in front and drop the preload so
    // the visible lil and the registry tell the same nap truth.
    log("wakeLil: nap tab removal failed for", windowId, err && err.message ? err.message : err);
    await safe(chrome.tabs.update(napTab.id, { active: true }), "tabs.update wake rollback");
    await safe(chrome.tabs.remove(freshTab.id), "tabs.remove wake preload");
    return false;
  }
  await clearNapState(windowId, originalUrl, captureKey);
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
    // Determine the currently focused window from live browser state.
    const lastFocused = await safe(chrome.windows.getLastFocused({}), "sweep getLastFocused");
    const focusedTop =
      lastFocused && lastFocused.focused && lastFocused.id !== undefined ? lastFocused.id : null;

    for (const [key, entry] of Object.entries(reg)) {
      const windowId = parseInt(key, 10);
      if (!entry) continue;

      // --- Ephemerality: auto-close hour-expiry lils idle past their limit. ---
      if (typeof entry.expiry === "number" && entry.expiry > 0) {
        const idleMs = now - (entry.lastInteraction || 0);
        if (idleMs > entry.expiry * 3600 * 1000) {
          log("ephemeral close", windowId, "idle(min)=" + Math.round(idleMs / 60000));
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
// PROMOTE — get a lil's tab out of ephemeral mode (unchanged from v2).
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
  if (sourceWindowId !== undefined) promotingWindowIds.add(sourceWindowId);

  let ok = false;
  try {
    if (typeof groupId === "number") {
      const res = await safe(chrome.tabs.group({ tabIds: [tabId], groupId }), "tabs.group");
      if (res !== null) {
        const g = await safe(chrome.tabGroups.get(groupId), "tabGroups.get");
        if (g && g.windowId !== undefined) {
          await safe(chrome.tabs.update(tabId, { active: true }), "tabs.update active group");
          await focusWindow(g.windowId);
        }
        ok = true;
      }
    } else {
      const target = await findNormalWindow();
      if (target && target.id !== undefined) {
        const moved = await safe(chrome.tabs.move(tabId, { windowId: target.id, index: -1 }), "tabs.move promote");
        if (moved !== null) {
          await safe(chrome.tabs.update(tabId, { active: true }), "tabs.update active");
          await focusWindow(target.id);
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
      await deregisterWindow(sourceWindowId);
    }
    return ok;
  } finally {
    if (sourceWindowId !== undefined) promotingWindowIds.delete(sourceWindowId);
  }
}

async function handOffToBrowser(tabId, browserSlug) {
  const tab = await safe(chrome.tabs.get(tabId), "tabs.get handoff");
  if (!tab || !tab.url) return false;
  const posted = postToHost({ type: "open-external", browser: browserSlug, url: tab.url });
  const wid = tab.windowId;
  if (wid !== undefined) {
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
  if (ctx.primaryBrowser && ctx.primaryBrowser === ctx.browser) return moveTabIntoHostBrowser(tabId, undefined);
  return handOffToBrowser(tabId, ctx.primaryBrowser || DEFAULT_CONTEXT.primaryBrowser);
}

// Open a URL into a lil already living in `windowId`. Used by "Open link in this lil".
async function openLinkInThisLil(windowId, url) {
  if (typeof url !== "string" || !url) return;
  const tabs = await safe(chrome.tabs.query({ windowId, active: true }), "tabs.query lil");
  const tab = tabs && tabs[0];
  if (tab && tab.id !== undefined) {
    await safe(chrome.tabs.update(tab.id, { url }), "tabs.update ctxmenu this-lil");
  }
}

// Fresh lil for a link. Names the invoking window as prior context so a normal
// tab's "new lil" action does not pretend the source was already a lil.
async function openLinkInNewLil(tab, url) {
  if (typeof url !== "string" || !url || !tab || tab.windowId === undefined) return null;
  const { left, top } = await cascadeOrigin(tab.windowId);
  const registered = await isRegisteredLil(tab.windowId);
  return openLil({
    url,
    left,
    top,
    priorContext: registered
      ? { kind: "lil", windowId: tab.windowId }
      : { kind: "normal-window", windowId: tab.windowId },
  });
}

// Context-menu incognito: never load the URL into a normal lil. If Chromium
// blocks incognito access, explain on the source page and leave the URL there.
async function openLinkInIncognitoLil(tab, url) {
  if (typeof url !== "string" || !url || !tab || tab.windowId === undefined) return null;
  const explain = () => {
    broadcastToWindow(tab.windowId, { action: "incognitoHint" });
    return null;
  };
  const allowed = await safe(chrome.extension.isAllowedIncognitoAccess(), "isAllowedIncognitoAccess");
  if (!allowed) return explain();
  const { left, top } = await cascadeOrigin(tab.windowId);
  const fromLil = (await isRegisteredLil(tab.windowId)) || incognitoLils.has(tab.windowId);
  const win =
    (await openLil({
      url,
      left,
      top,
      incognito: true,
      priorContext: fromLil
        ? { kind: "lil", windowId: tab.windowId }
        : { kind: "normal-window", windowId: tab.windowId },
    })) || explain();
  return win;
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
          const slept = senderWindowId !== undefined ? await sleepLil(senderWindowId) : false;
          sendResponse({ ok: slept });
          return;
        }
        case "openSettings": {
          // Contextual request for the native Settings window. Posts the
          // dedicated host command; never creates or focuses a browser window.
          const posted = postToHost({ type: "open-settings" });
          sendResponse({ ok: posted });
          return;
        }
        case "reopenIncognito": {
          // Caret-menu "Reopen in incognito lil": open same URL incognito, close current.
          const url = msg.url || (sender && sender.tab ? sender.tab.url : "");
          if (senderWindowId !== undefined) {
            const { left, top } = await cascadeOrigin(senderWindowId);
            await openIncognitoLil(url, left, top);
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
          // From the sleep page click. ok:false lets the nap page run its own
          // fallback navigation instead of staying stranded.
          const woke = senderWindowId !== undefined ? await wakeLil(senderWindowId) : false;
          sendResponse({ ok: woke });
          return;
        }
        case "closeWindow": {
          if (senderWindowId !== undefined) {
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
  const tabs = await safe(chrome.tabs.query({ active: true, lastFocusedWindow: true }), "tabs.query command");
  const tab = tabs && tabs[0];
  if (!tab || tab.windowId === undefined) return;
  if (!(await isEphemeralWindow(tab.windowId))) return;
  if (command === "promote-tab") {
    await promoteTab(tab.id, "default");
    return;
  }
  if (command === "let-this-lil-nap") {
    await sleepLil(tab.windowId);
  }
});

// ===========================================================================
// CONTEXT MENUS — recreated cleanly in onInstalled (removeAll first).
//
// Visibility and click authorization share one policy: a label is shown only
// where its action would be true. Tab-strip registration is isolated so an
// unsupported `tab` context cannot prevent the other menus from loading.
// link (lil windows):   Open link in new lil / this lil / incognito lil
// page (lil windows):   Let This Lil Nap, Never nap {host} / Allow napping {host}
// page (NORMAL windows): Send to lil
// onClicked handlers verify window context and no-op gracefully.
// ===========================================================================

const CTX_NEW_LIL = "open-link-new-lil";
const CTX_THIS_LIL = "open-link-this-lil";
const CTX_INCOGNITO_LIL = "open-link-incognito-lil";
const CTX_SLEEP = "sleep-this-lil";
const CTX_WHITELIST = "toggle-whitelist";
const CTX_SEND_TO_LIL = "send-to-lil";
const CTX_SEND_TAB_TO_LIL = "send-tab-to-lil";

// One snapshot of the invoking tab. Visibility and click authorization both
// read this so a label cannot appear where its action would no-op, or run
// where its label would be a lie.
function contextActionSnapshot(tab, registeredLil) {
  const incognitoLil = !!(tab && incognitoLils.has(tab.windowId));
  const incognito = !!(tab && tab.incognito) || incognitoLil;
  return {
    registeredLil: !!registeredLil,
    incognitoLil,
    incognito,
    normalPage: !registeredLil && !incognito,
    host: hostOf(tab && tab.url),
  };
}

function contextActionAllowed(menuItemId, snap) {
  switch (menuItemId) {
    case CTX_THIS_LIL:
      return snap.registeredLil;
    case CTX_NEW_LIL:
      return snap.registeredLil || snap.normalPage;
    case CTX_INCOGNITO_LIL:
      return snap.registeredLil || snap.normalPage || snap.incognito;
    case CTX_SEND_TO_LIL:
    case CTX_SEND_TAB_TO_LIL:
      return snap.normalPage;
    case CTX_SLEEP:
      return snap.registeredLil;
    case CTX_WHITELIST:
      return (snap.registeredLil || snap.incognitoLil) && !!snap.host;
    default:
      return false;
  }
}

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    try {
      // Hidden until the shared policy runs; Chrome otherwise shows every item.
      chrome.contextMenus.create({
        id: CTX_NEW_LIL,
        title: "Open link in new lil",
        contexts: ["link"],
        visible: false,
      });
      chrome.contextMenus.create({
        id: CTX_THIS_LIL,
        title: "Open link in this lil",
        contexts: ["link"],
        visible: false,
      });
      chrome.contextMenus.create({
        id: CTX_INCOGNITO_LIL,
        title: "Open link in incognito lil",
        contexts: ["link"],
        visible: false,
      });
      chrome.contextMenus.create({
        id: CTX_SLEEP,
        title: "Let This Lil Nap",
        contexts: ["page"],
        visible: false,
      });
      chrome.contextMenus.create({
        id: CTX_WHITELIST,
        title: "Never nap this site",
        contexts: ["page"],
        visible: false,
      });
      chrome.contextMenus.create({
        id: CTX_SEND_TO_LIL,
        title: "Send to lil",
        contexts: ["page"],
        visible: false,
      });
    } catch (err) {
      log("contextMenus.create error", err && err.message ? err.message : err);
    }
    createTabStripSend();
    void applyContextMenusForFocusedTab();
  });
}

function createTabStripSend() {
  try {
    chrome.contextMenus.create(
      { id: CTX_SEND_TAB_TO_LIL, title: "Send Tab to Lil", contexts: ["tab"], visible: false },
      () => {
        const err = chrome.runtime.lastError;
        if (err) log("Send Tab to Lil omitted", err.message);
      }
    );
  } catch (err) {
    log("Send Tab to Lil omitted", err && err.message ? err.message : err);
  }
}

// Keep titles and visibility in lockstep with the click policy for this tab.
async function updateContextMenusForTab(tab) {
  if (!tab || tab.windowId === undefined) return;
  const registeredLil = await isRegisteredLil(tab.windowId);
  const snap = contextActionSnapshot(tab, registeredLil);
  const host = snap.host;
  const ctx = await getContext();
  const whitelisted = hostWhitelisted(host, ctx.sleep && ctx.sleep.whitelist);

  const setItem = (id, props) => {
    chrome.contextMenus.update(id, props, () => void chrome.runtime.lastError);
  };

  setItem(CTX_THIS_LIL, { visible: contextActionAllowed(CTX_THIS_LIL, snap) });
  setItem(CTX_NEW_LIL, { visible: contextActionAllowed(CTX_NEW_LIL, snap) });
  setItem(CTX_INCOGNITO_LIL, { visible: contextActionAllowed(CTX_INCOGNITO_LIL, snap) });
  setItem(CTX_SLEEP, {
    title: "Let This Lil Nap",
    visible: contextActionAllowed(CTX_SLEEP, snap),
  });
  setItem(CTX_WHITELIST, {
    title: host ? (whitelisted ? "Allow napping " + host : "Never nap " + host) : "Never nap this site",
    visible: contextActionAllowed(CTX_WHITELIST, snap),
  });
  setItem(CTX_SEND_TO_LIL, { visible: contextActionAllowed(CTX_SEND_TO_LIL, snap) });
  setItem(CTX_SEND_TAB_TO_LIL, { visible: contextActionAllowed(CTX_SEND_TAB_TO_LIL, snap) });
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
  const { left, top } = await cascadeOrigin(srcWindowId);
  return openLil({
    tabId,
    left,
    top,
    priorContext: { kind: "normal-window", windowId: srcWindowId },
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (!tab || tab.windowId === undefined) return;
    const registeredLil = await isRegisteredLil(tab.windowId);
    const snap = contextActionSnapshot(tab, registeredLil);
    if (!contextActionAllowed(info.menuItemId, snap)) return;

    switch (info.menuItemId) {
      case CTX_NEW_LIL:
        if (info.linkUrl) await openLinkInNewLil(tab, info.linkUrl);
        return;
      case CTX_THIS_LIL:
        if (info.linkUrl) await openLinkInThisLil(tab.windowId, info.linkUrl);
        return;
      case CTX_INCOGNITO_LIL:
        if (info.linkUrl) await openLinkInIncognitoLil(tab, info.linkUrl);
        return;
      case CTX_SLEEP:
        await sleepLil(tab.windowId);
        return;
      case CTX_WHITELIST: {
        const host = hostOf(tab.url);
        if (!host) return;
        const ctx = await getContext();
        const currentlyWhitelisted = hostWhitelisted(host, ctx.sleep && ctx.sleep.whitelist);
        await toggleWhitelist(host, !currentlyWhitelisted);
        await updateContextMenusForTab(tab);
        return;
      }
      case CTX_SEND_TO_LIL:
      case CTX_SEND_TAB_TO_LIL:
        if (tab.id !== undefined) await sendTabToLil(tab.id, tab.windowId);
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

async function applyContextMenusForFocusedTab() {
  const tabs = await safe(
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    "tabs.query menu policy"
  );
  if (tabs && tabs[0]) await updateContextMenusForTab(tabs[0]);
}

chrome.runtime.onStartup.addListener(async () => {
  connectNative();
  await ensureSweepAlarm();
  await restoreWindows();
  await applyContextMenusForFocusedTab();
});

chrome.runtime.onInstalled.addListener(async () => {
  connectNative();
  createContextMenus();
  await ensureSweepAlarm();
});

// Top-level: runs on every service-worker wake.
connectNative();
ensureSweepAlarm();
