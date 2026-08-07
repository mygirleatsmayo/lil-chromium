// lil-chromium background service worker.
//
// Responsibilities:
//   - Hold a native-messaging port to the relay host open forever (keep-alive).
//   - Open ephemeral "lils" on `open` messages and answer history queries.
//   - Track every lil in a persistent registry so parked lils survive
//     browser restarts/crashes/updates (restored on onStartup).
//   - Handshake with the host for browser identity + user config (get-context).
//   - Route link clicks inside lils per configured linkBehavior (same-lil / new-lil).
//   - Promote a lil into normal browsing (no-reload move) or hand it to another
//     Chromium-family browser via the host (open-external).

const NATIVE_HOST = "com.lilchromium.relay";
const REGISTRY_KEY = "ephemeralWindows"; // { [windowId]: {url, bounds:{left,top,width,height}} }
const LAST_SIZE_KEY = "lastSize"; // {width, height} — last user-resized lil size
const CONTEXT_KEY = "hostContext"; // cached `context` reply (stale-but-usable across SW restarts)
const DEFAULT_SIZE = { width: 1100, height: 800 };
const HISTORY_WINDOW_MS = 90 * 24 * 3600 * 1000; // 90 days
const CASCADE_OFFSET = 32;

// Context handshake: how long a clickHint is considered a match for a nav target.
const CLICK_HINT_TTL_MS = 1500;
const CLICK_HINT_MAX = 10; // ring buffer size

// Built-in fallback context — used before the first handshake completes, or if
// the host never answers. Mirrors PROTOCOL.md defaults (helium/chrome/same-lil).
const DEFAULT_CONTEXT = {
  browser: "chrome",
  browserName: "Chrome",
  defaultBrowser: "helium",
  defaultBrowserName: "Helium",
  fallbackBrowser: "chrome",
  linkBehavior: "same-lil",
  knownBrowsers: [],
};

// ---------------------------------------------------------------------------
// CONTEXT — browser identity + user config from the host.
//
// We keep an in-memory copy (fast) backed by storage.local (survives SW
// restarts as a stale-but-usable cache). On every port (re)connect we ask the
// host for a fresh `context` via `get-context`; the reply refreshes both.
// ---------------------------------------------------------------------------

let contextCache = null; // last known `context` object (in-memory)
let contextRequestId = 0;

// Returns the best context we have: live cache, else persisted cache, else the
// built-in defaults. Callers get a usable object without ever blocking on the
// host handshake.
async function getContext() {
  if (contextCache) return contextCache;
  const obj = await safe(chrome.storage.local.get(CONTEXT_KEY), "get context");
  const cached = obj && obj[CONTEXT_KEY];
  if (cached && typeof cached === "object") {
    contextCache = cached;
    return cached;
  }
  return { ...DEFAULT_CONTEXT };
}

async function storeContext(ctx) {
  contextCache = ctx;
  await safe(chrome.storage.local.set({ [CONTEXT_KEY]: ctx }), "set context");
}

// Ask the host for fresh context. Fire-and-forget: the reply arrives as a
// `context` port message (handlePortMessage) which calls storeContext.
function requestContext() {
  contextRequestId += 1;
  postToHost({ type: "get-context", id: "ctx-" + contextRequestId });
}

// ---------------------------------------------------------------------------
// CLICK HINTS — modifier-key relay for link behavior.
//
// The content script fires {action:"clickHint", url, meta, ts} on anchor
// clicks BEFORE the navigation happens, so we know whether ⌘ was held. We keep
// a tiny in-memory ring buffer and, when onCreatedNavigationTarget fires, match
// the target URL against recent hints (within CLICK_HINT_TTL_MS) to decide
// whether to FLIP the configured linkBehavior for this one click.
//
// This buffer is intentionally memory-only: if the SW restarts between the
// click and the navigation the hint is lost and we fall back to the configured
// default. That's an accepted, rare edge (documented in PROTOCOL.md).
// ---------------------------------------------------------------------------

const clickHints = []; // ring buffer of {url, meta, ts}

function recordClickHint(url, meta, ts) {
  if (typeof url !== "string" || !url) return;
  clickHints.push({ url, meta: !!meta, ts: typeof ts === "number" ? ts : Date.now() });
  // Trim oldest so the buffer never grows past CLICK_HINT_MAX.
  while (clickHints.length > CLICK_HINT_MAX) clickHints.shift();
}

// Strip the #fragment from a URL for a looser match. Returns the input on parse
// failure (best effort — we only use this for comparison).
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

// Find a recent hint matching `url`. Prefer an exact match; otherwise match
// ignoring the hash (navigations sometimes normalize/drop fragments). Consumes
// the matched hint so a single click can't flip two navigations.
function consumeClickHint(url) {
  if (typeof url !== "string" || !url) return null;
  const now = Date.now();
  const noHash = urlNoHash(url);

  // Newest-first so the most recent click wins on duplicate URLs.
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

// ---------------------------------------------------------------------------
// Small defensive helpers. Chrome callback APIs set chrome.runtime.lastError
// instead of throwing; the promise-style APIs reject. We normalize both so a
// single bad window/tab can never take down the worker's control flow.
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

// ===========================================================================
// NATIVE PORT — load-bearing keep-alive.
//
// The port is opened at top-level SW execution (every wake), plus on
// onStartup/onInstalled. While it is open the MV3 service worker stays alive,
// which is exactly what we want: the host relays `open`/`history-query` at any
// time and we must be ready. On disconnect we reconnect with exponential
// backoff (250ms -> 5s) forever, so a host restart can never orphan us.
// ===========================================================================

let port = null;
let reconnectDelay = 250;
const RECONNECT_MAX = 5000;
let reconnectTimer = null;

function connectNative() {
  if (port) return; // already connected
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

  // Successful connect: reset backoff.
  reconnectDelay = 250;
  log("native port connected");

  // Fresh handshake on every (re)connect: the host reads config.json anew and
  // stamps its own detected identity, so this refreshes any stale cache.
  requestContext();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = reconnectDelay;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectNative();
  }, delay);
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
      await openLittleWindow(msg.url, msg.left, msg.top);
    } else if (msg.type === "history-query") {
      await answerHistoryQuery(msg);
    } else if (msg.type === "context") {
      // Handshake reply. Keep only the contract fields; ignore `type`/`id`.
      await storeContext({
        browser: msg.browser || DEFAULT_CONTEXT.browser,
        browserName: msg.browserName || DEFAULT_CONTEXT.browserName,
        defaultBrowser: msg.defaultBrowser || DEFAULT_CONTEXT.defaultBrowser,
        defaultBrowserName: msg.defaultBrowserName || DEFAULT_CONTEXT.defaultBrowserName,
        fallbackBrowser: msg.fallbackBrowser || DEFAULT_CONTEXT.fallbackBrowser,
        linkBehavior: msg.linkBehavior === "new-lil" ? "new-lil" : "same-lil",
        knownBrowsers: Array.isArray(msg.knownBrowsers) ? msg.knownBrowsers : [],
      });
      log("context updated", "browser=" + msg.browser, "default=" + msg.defaultBrowser, "link=" + msg.linkBehavior);
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
// REGISTRY — persistent record of little windows.
// ===========================================================================

async function getRegistry() {
  const obj = await safe(chrome.storage.local.get(REGISTRY_KEY), "get registry");
  return (obj && obj[REGISTRY_KEY]) || {};
}

async function setRegistry(reg) {
  await safe(chrome.storage.local.set({ [REGISTRY_KEY]: reg }), "set registry");
}

async function registerWindow(windowId, url, bounds) {
  const reg = await getRegistry();
  reg[windowId] = { url, bounds };
  await setRegistry(reg);
}

async function deregisterWindow(windowId) {
  const reg = await getRegistry();
  if (reg[windowId] !== undefined) {
    delete reg[windowId];
    await setRegistry(reg);
  }
}

async function isEphemeralWindow(windowId) {
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
// DISPLAY CLAMPING — keep a window fully inside the display that contains
// (left,top). Falls back to centering on the primary display when coords are
// missing/invalid.
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
    if (!target) {
      target = list.find((d) => d.isPrimary) || list[0];
    }
  }

  // No display info at all: return coords as-is (best effort).
  if (!target) {
    return {
      left: haveCoords ? Math.round(left) : undefined,
      top: haveCoords ? Math.round(top) : undefined,
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  const wa = target.workArea;
  // Clamp size to the work area first.
  const w = Math.min(Math.round(width), wa.width);
  const h = Math.min(Math.round(height), wa.height);

  let x, y;
  if (haveCoords) {
    x = Math.round(left);
    y = Math.round(top);
  } else {
    // Center on the target (primary) display.
    x = wa.left + Math.round((wa.width - w) / 2);
    y = wa.top + Math.round((wa.height - h) / 2);
  }

  // Push fully inside the work area.
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
  const size = await getLastSize();
  const bounds = await clampBounds(left, top, size.width, size.height);

  const createOpts = {
    url,
    type: "popup",
    focused: true,
    width: bounds.width,
    height: bounds.height,
  };
  if (bounds.left !== undefined) createOpts.left = bounds.left;
  if (bounds.top !== undefined) createOpts.top = bounds.top;

  const win = await safe(chrome.windows.create(createOpts), "windows.create little");
  if (!win || win.id === undefined) return null;

  await registerWindow(win.id, url, {
    left: win.left,
    top: win.top,
    width: win.width,
    height: win.height,
  });
  return win;
}

// ===========================================================================
// RESTORE — the "parked for days survives restart" feature.
//
// On startup the OLD window ids in the registry are dead. We read every saved
// entry, reopen each as a fresh popup at its saved bounds, and rebuild the
// registry from scratch keyed on the NEW window ids. We never trust the old
// ids: the registry is fully reconstructed from what we actually reopened, so
// stale/dead ids self-heal.
// ===========================================================================

async function restoreWindows() {
  const oldReg = await getRegistry();
  const entries = Object.values(oldReg);
  if (!entries.length) return;

  // Start clean so a crash mid-restore can't leave phantom ids around; we
  // repopulate below with the ids Chrome actually hands back.
  await setRegistry({});

  for (const entry of entries) {
    if (!entry || typeof entry.url !== "string" || !entry.url) continue;
    const b = entry.bounds || {};
    const clamped = await clampBounds(b.left, b.top, b.width || DEFAULT_SIZE.width, b.height || DEFAULT_SIZE.height);

    const opts = {
      url: entry.url,
      type: "popup",
      focused: false,
      width: clamped.width,
      height: clamped.height,
    };
    if (clamped.left !== undefined) opts.left = clamped.left;
    if (clamped.top !== undefined) opts.top = clamped.top;

    const win = await safe(chrome.windows.create(opts), "windows.create restore");
    if (win && win.id !== undefined) {
      await registerWindow(win.id, entry.url, {
        left: win.left,
        top: win.top,
        width: win.width,
        height: win.height,
      });
    }
  }
  log("restored", entries.length, "little window(s)");
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
    reg[key].url = changeInfo.url;
    await setRegistry(reg);
  }
});

chrome.windows.onBoundsChanged.addListener(async (win) => {
  if (!win || win.id === undefined) return;
  const reg = await getRegistry();
  const key = String(win.id);
  if (!reg[key]) return;
  reg[key].bounds = {
    left: win.left,
    top: win.top,
    width: win.width,
    height: win.height,
  };
  await setRegistry(reg);
  // A resized little window updates the remembered size for future `open`s.
  if (typeof win.width === "number" && typeof win.height === "number") {
    await setLastSize(win.width, win.height);
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  await deregisterWindow(windowId);
});

// ===========================================================================
// CHILD LINK CASCADE + LINK BEHAVIOR
//
// When a link inside a lil opens a new tab/window (target=_blank, window.open,
// etc.), webNavigation.onCreatedNavigationTarget fires with the source tab id.
// If the source lives in a lil we decide, per configured linkBehavior:
//   - "new-lil":  re-parent the new tab into its OWN popup, cascaded +32/+32.
//   - "same-lil": navigate the source lil's tab to the URL and discard the
//                 spawned tab (keeps everything in one lil).
// A recent clickHint carrying meta=true FLIPS whichever behavior is configured.
//
// chrome.windows.create accepts tabId + type:"popup" together (verified via
// Chrome windows API docs: developer.chrome.com/docs/extensions/reference/api/windows
// — tabId moves the existing tab into the new window; only tabId+url conflict).
// ===========================================================================

// Cascade an existing tab into its own offset popup lil, based off the given
// source window bounds. Registers the new lil. Returns the created window.
async function cascadeTabToLil(tabId, srcWindowId, fallbackUrl) {
  const srcWin = await safe(chrome.windows.get(srcWindowId), "windows.get source");
  const baseLeft = srcWin && typeof srcWin.left === "number" ? srcWin.left : 0;
  const baseTop = srcWin && typeof srcWin.top === "number" ? srcWin.top : 0;
  const size = await getLastSize();

  const clamped = await clampBounds(
    baseLeft + CASCADE_OFFSET,
    baseTop + CASCADE_OFFSET,
    size.width,
    size.height
  );

  const opts = {
    tabId,
    type: "popup",
    focused: true,
    width: clamped.width,
    height: clamped.height,
  };
  if (clamped.left !== undefined) opts.left = clamped.left;
  if (clamped.top !== undefined) opts.top = clamped.top;

  const win = await safe(chrome.windows.create(opts), "windows.create cascade");
  if (win && win.id !== undefined) {
    const url =
      fallbackUrl || (win.tabs && win.tabs[0] && win.tabs[0].url) || "";
    await registerWindow(win.id, url || "", {
      left: win.left,
      top: win.top,
      width: win.width,
      height: win.height,
    });
  }
  return win;
}

chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  try {
    // sourceTabId is a tab id — resolve its window before checking the registry.
    const srcTab = await safe(chrome.tabs.get(details.sourceTabId), "tabs.get source");
    if (!srcTab || srcTab.windowId === undefined) return;
    if (!(await isEphemeralWindow(srcTab.windowId))) return;

    // Decide effective behavior: configured default, FLIPPED if this exact nav
    // came from a ⌘-modified click (matched via the clickHint ring buffer).
    const ctx = await getContext();
    let behavior = ctx.linkBehavior === "new-lil" ? "new-lil" : "same-lil";
    const hint = consumeClickHint(details.url);
    if (hint && hint.meta) {
      behavior = behavior === "same-lil" ? "new-lil" : "same-lil";
    }

    if (behavior === "same-lil") {
      // Keep everything in one lil: point the source tab at the new URL and
      // drop the tab the browser spun up. Guard both ops; if the in-place
      // update fails, fall back to the cascade so the link still opens.
      const updated = await safe(
        chrome.tabs.update(srcTab.id, { url: details.url }),
        "tabs.update same-lil"
      );
      await safe(chrome.tabs.remove(details.tabId), "tabs.remove spawned");
      if (updated === null) {
        await cascadeTabToLil(details.tabId, srcTab.windowId, details.url);
      }
      return;
    }

    // "new-lil": cascade the spawned tab into its own popup lil.
    await cascadeTabToLil(details.tabId, srcTab.windowId, details.url);
  } catch (err) {
    log("cascade error", err && err.message ? err.message : err);
  }
});

// ===========================================================================
// PROMOTE — get a lil's tab out of ephemeral mode.
//
// Two fundamentally different kinds of promotion:
//   A) STAY in this browser: state-preserving no-reload move of the tab into a
//      normal (non-popup) window or an existing tab group. Used for dest
//      "host-tab", "group", and dest "default" WHEN this browser is the user's
//      configured default.
//   B) HAND OFF to another browser: we can't move live tab state across
//      browsers, so we ask the host to open the URL in that browser
//      (open-external) and close the lil. Used for dest "browser", and dest
//      "default" WHEN this browser is NOT the default.
//
// Promote matrix (dest -> action):
//   "default"  + defaultBrowser === thisBrowser -> move into this browser (A)
//   "default"  + defaultBrowser !== thisBrowser -> open-external to default (B)
//   "host-tab"                                    -> move into this browser (A)
//   "group"    (+ groupId)                        -> move into that group (A)
//   "browser"  (+ browser slug)                   -> open-external to slug (B)
// ===========================================================================

// Find a normal (non-popup) window to promote into.
// getLastFocused supports windowTypes:["normal"] in Chrome MV3 (verified via
// Chrome windows API docs). We still fall back to querying all windows and
// picking the focused/most-recent normal one for robustness.
async function findNormalWindow() {
  const lf = await safe(
    chrome.windows.getLastFocused({ windowTypes: ["normal"] }),
    "getLastFocused normal"
  );
  if (lf && lf.type === "normal" && lf.id !== undefined) return lf;

  const all = await safe(chrome.windows.getAll({ windowTypes: ["normal"] }), "getAll normal");
  if (all && all.length) {
    const focused = all.find((w) => w.focused);
    return focused || all[all.length - 1];
  }
  return null;
}

// (A) State-preserving no-reload move of a lil's tab into a normal window (or a
// tab group) within THIS browser. Returns true on success. This is the v1
// behavior, factored out so both "host-tab" and same-browser "default" reuse it.
async function moveTabIntoHostBrowser(tabId, groupId) {
  const tab = await safe(chrome.tabs.get(tabId), "tabs.get promote");
  if (!tab) return false;
  const sourceWindowId = tab.windowId;

  let ok = false;

  if (typeof groupId === "number") {
    // tabs.group with a groupId in another window auto-moves the tab into that
    // group's window (verified via MDN tabs.group + Chrome tabGroups docs).
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
    // Move into an existing normal window.
    const target = await findNormalWindow();
    if (target && target.id !== undefined) {
      const moved = await safe(
        chrome.tabs.move(tabId, { windowId: target.id, index: -1 }),
        "tabs.move promote"
      );
      if (moved !== null) {
        await safe(chrome.tabs.update(tabId, { active: true }), "tabs.update active");
        await safe(chrome.windows.update(target.id, { focused: true }), "windows.update focus");
        ok = true;
      }
    }
    // Fallback (1): no normal window / move failed -> new window from the tab.
    if (!ok) {
      const win = await safe(chrome.windows.create({ tabId, focused: true }), "windows.create promote-fallback");
      ok = !!win;
    }
    // Last resort (2): open the URL fresh in the target window, drop old tab.
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
    // The lil auto-closes once its only tab leaves; drop it from the registry
    // so onRemoved has nothing to do and restore won't reopen it.
    await deregisterWindow(sourceWindowId);
  }
  return ok;
}

// (B) Hand a lil's URL off to another Chromium-family browser via the host,
// then close the lil. State isn't preservable across browsers (accepted).
// Returns true if the host request was posted.
async function handOffToBrowser(tabId, browserSlug) {
  const tab = await safe(chrome.tabs.get(tabId), "tabs.get handoff");
  if (!tab || !tab.url) return false;
  const posted = postToHost({ type: "open-external", browser: browserSlug, url: tab.url });
  // Close the lil regardless of the port result: if the host is down there's
  // nothing useful the lil can still do, and leaving it open would be confusing.
  const wid = tab.windowId;
  if (wid !== undefined) {
    await deregisterWindow(wid);
    await safe(chrome.windows.remove(wid), "windows.remove handoff");
  }
  return posted;
}

// Promote dispatcher — resolves the matrix above and delegates. `browser` is
// only consulted for dest "browser".
async function promoteTab(tabId, dest, groupId, browser) {
  const ctx = await getContext();

  if (dest === "group" && typeof groupId === "number") {
    return moveTabIntoHostBrowser(tabId, groupId);
  }
  if (dest === "host-tab") {
    return moveTabIntoHostBrowser(tabId, undefined);
  }
  if (dest === "browser" && typeof browser === "string" && browser) {
    return handOffToBrowser(tabId, browser);
  }
  // dest === "default" (the ⌘O / button action) and any unknown dest.
  if (ctx.defaultBrowser && ctx.defaultBrowser === ctx.browser) {
    // This browser IS the default: stay put with a no-reload move.
    return moveTabIntoHostBrowser(tabId, undefined);
  }
  // A different browser is the default: hand off to it.
  return handOffToBrowser(tabId, ctx.defaultBrowser || DEFAULT_CONTEXT.defaultBrowser);
}

// Open a URL into a lil already living in `windowId` per link behavior. Used by
// the context-menu handlers (which act on a registered lil window directly).
async function openLinkForLil(windowId, url, mode) {
  if (typeof url !== "string" || !url) return;
  if (mode === "same-lil") {
    // Navigate the lil's own (active) tab in place.
    const tabs = await safe(chrome.tabs.query({ windowId, active: true }), "tabs.query lil");
    const tab = tabs && tabs[0];
    if (tab && tab.id !== undefined) {
      await safe(chrome.tabs.update(tab.id, { url }), "tabs.update ctxmenu same-lil");
    }
    return;
  }
  // "new-lil": open the URL in a fresh tab then cascade it into its own lil.
  const created = await safe(chrome.tabs.create({ windowId, url, active: false }), "tabs.create ctxmenu");
  if (created && created.id !== undefined) {
    await cascadeTabToLil(created.id, windowId, url);
  }
}

// ===========================================================================
// ADDRESS NAVIGATION — the overlay's address field.
//
// Decide URL vs. search:
//   - Has an explicit scheme (foo://) -> use as-is.
//   - Looks domain-ish (contains a dot, no whitespace) -> prepend https://.
//   - Otherwise -> Google search for the raw text.
// ===========================================================================

function resolveNavigation(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "https://www.google.com";

  // Explicit scheme like https://, http://, ftp://, about:, chrome://…
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return raw;
  }
  // Domain-ish: a dot and no spaces (e.g. "example.com", "sub.host/path").
  if (/^[^\s]+\.[^\s]+$/.test(raw)) {
    return "https://" + raw;
  }
  // Everything else is a search query.
  return "https://www.google.com/search?q=" + encodeURIComponent(raw);
}

// ===========================================================================
// OVERLAY / COMMAND MESSAGE HANDLING
// ===========================================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Return true to keep the response channel open for async work.
  (async () => {
    try {
      if (!msg || typeof msg !== "object") {
        sendResponse({ ok: false });
        return;
      }
      switch (msg.action) {
        case "isEphemeral": {
          const wid = sender && sender.tab ? sender.tab.windowId : undefined;
          sendResponse({ ephemeral: await isEphemeralWindow(wid) });
          return;
        }
        case "getContext": {
          // Overlay reads context to label its button + build the caret menu.
          sendResponse({ context: await getContext() });
          return;
        }
        case "listGroups": {
          const groups = await safe(chrome.tabGroups.query({}), "tabGroups.query");
          const items = (groups || []).map((g) => ({
            id: g.id,
            title: g.title || "",
            color: g.color || "grey",
          }));
          sendResponse({ groups: items });
          return;
        }
        case "promote": {
          const tabId = sender && sender.tab ? sender.tab.id : undefined;
          if (tabId === undefined) {
            sendResponse({ ok: false });
            return;
          }
          const ok = await promoteTab(tabId, msg.dest || "default", msg.groupId, msg.browser);
          sendResponse({ ok });
          return;
        }
        case "clickHint": {
          // Fire-and-forget modifier relay from the content script (see the
          // CLICK HINTS section). Never blocks the click.
          recordClickHint(msg.url, msg.meta, msg.ts);
          sendResponse({ ok: true });
          return;
        }
        case "navigate": {
          const tabId = sender && sender.tab ? sender.tab.id : undefined;
          if (tabId === undefined) {
            sendResponse({ ok: false });
            return;
          }
          const url = resolveNavigation(msg.input);
          const res = await safe(chrome.tabs.update(tabId, { url }), "tabs.update navigate");
          sendResponse({ ok: res !== null, url });
          return;
        }
        case "closeWindow": {
          const wid = sender && sender.tab ? sender.tab.windowId : undefined;
          if (wid !== undefined) {
            await deregisterWindow(wid);
            await safe(chrome.windows.remove(wid), "windows.remove close");
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

// promote-tab command: promote the active tab if its window is a lil. Backstop
// for the ⌘O content-script handler — uses the same "default" dest matrix.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "promote-tab") return;
  const tabs = await safe(chrome.tabs.query({ active: true, lastFocusedWindow: true }), "tabs.query command");
  const tab = tabs && tabs[0];
  if (!tab || tab.windowId === undefined) return;
  if (!(await isEphemeralWindow(tab.windowId))) return;
  await promoteTab(tab.id, "default");
});

// ===========================================================================
// CONTEXT MENUS — link right-click actions (contexts:["link"]).
//
// MV3 context menus can't be scoped per-window, so both items are always
// present; onClicked no-ops unless the click happened in a registered lil
// (checked via tab.windowId). Created in onInstalled (SW-safe); removeAll first
// so a reinstall/update can't hit a duplicate-id error.
// ===========================================================================

const CTX_NEW_LIL = "open-link-new-lil";
const CTX_SAME_LIL = "open-link-same-lil";

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    // Swallow any lastError from removeAll (nothing to remove is fine).
    void chrome.runtime.lastError;
    try {
      chrome.contextMenus.create({
        id: CTX_NEW_LIL,
        title: "Open link in new lil",
        contexts: ["link"],
      });
      chrome.contextMenus.create({
        id: CTX_SAME_LIL,
        title: "Open link in this lil",
        contexts: ["link"],
      });
    } catch (err) {
      log("contextMenus.create error", err && err.message ? err.message : err);
    }
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (!tab || tab.windowId === undefined) return;
    if (!info || !info.linkUrl) return;
    // No-op outside a lil — the menu items exist everywhere but only act here.
    if (!(await isEphemeralWindow(tab.windowId))) return;

    if (info.menuItemId === CTX_NEW_LIL) {
      await openLinkForLil(tab.windowId, info.linkUrl, "new-lil");
    } else if (info.menuItemId === CTX_SAME_LIL) {
      await openLinkForLil(tab.windowId, info.linkUrl, "same-lil");
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
  await restoreWindows();
});

chrome.runtime.onInstalled.addListener(() => {
  connectNative();
  createContextMenus();
});

// Top-level: runs on every service-worker wake. Opening the port here is what
// keeps this worker alive between events.
connectNative();
