// lil-chromium background service worker.
//
// Responsibilities:
//   - Hold a native-messaging port to the relay host open forever (keep-alive).
//   - Open ephemeral "little windows" on `open` messages and answer history queries.
//   - Track every little window in a persistent registry so parked windows survive
//     Chrome restarts/crashes/updates (restored on onStartup).
//   - Cascade child links into new offset popups, and promote a little window into
//     normal Chrome without reloading the tab.

const NATIVE_HOST = "com.lilchromium.relay";
const REGISTRY_KEY = "ephemeralWindows"; // { [windowId]: {url, bounds:{left,top,width,height}} }
const LAST_SIZE_KEY = "lastSize"; // {width, height} — last user-resized little window size
const DEFAULT_SIZE = { width: 1100, height: 800 };
const HISTORY_WINDOW_MS = 90 * 24 * 3600 * 1000; // 90 days
const CASCADE_OFFSET = 32;

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
// CHILD LINK CASCADE
//
// When a link inside a little window opens a new tab/window (target=_blank,
// window.open, etc.), webNavigation.onCreatedNavigationTarget fires with the
// source tab id. If the source lives in a little window we re-parent the new
// tab into its OWN popup, cascaded +32/+32 from the source window.
//
// chrome.windows.create accepts tabId + type:"popup" together (verified via
// Chrome windows API docs: developer.chrome.com/docs/extensions/reference/api/windows
// — tabId moves the existing tab into the new window; only tabId+url conflict).
// ===========================================================================

chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  try {
    // sourceTabId is a tab id — resolve its window before checking the registry.
    const srcTab = await safe(chrome.tabs.get(details.sourceTabId), "tabs.get source");
    if (!srcTab || srcTab.windowId === undefined) return;
    if (!(await isEphemeralWindow(srcTab.windowId))) return;

    const srcWin = await safe(chrome.windows.get(srcTab.windowId), "windows.get source");
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
      tabId: details.tabId,
      type: "popup",
      focused: true,
      width: clamped.width,
      height: clamped.height,
    };
    if (clamped.left !== undefined) opts.left = clamped.left;
    if (clamped.top !== undefined) opts.top = clamped.top;

    const win = await safe(chrome.windows.create(opts), "windows.create cascade");
    if (win && win.id !== undefined) {
      const url = srcTab && details.url ? details.url : (win.tabs && win.tabs[0] && win.tabs[0].url) || "";
      await registerWindow(win.id, url || "", {
        left: win.left,
        top: win.top,
        width: win.width,
        height: win.height,
      });
    }
  } catch (err) {
    log("cascade error", err && err.message ? err.message : err);
  }
});

// ===========================================================================
// PROMOTE — move a little window's tab into normal Chrome without reloading.
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

// Relocate a tab into normal Chrome, state-preserving, trying strategies in
// order. Returns true on success.
async function promoteTab(tabId, dest, groupId) {
  const tab = await safe(chrome.tabs.get(tabId), "tabs.get promote");
  if (!tab) return false;
  const sourceWindowId = tab.windowId;

  let ok = false;

  if (dest === "group" && typeof groupId === "number") {
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
  } else if (dest === "window") {
    // Explicit "new Chrome window" — a fresh normal window with this tab.
    const win = await safe(chrome.windows.create({ tabId, focused: true }), "windows.create promote-window");
    ok = !!win;
  } else {
    // dest === "tab" (default): move into an existing normal window.
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
    // The little window auto-closes once its only tab leaves; drop it from the
    // registry so onRemoved has nothing to do and restore won't reopen it.
    await deregisterWindow(sourceWindowId);
  }
  return ok;
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
          const ok = await promoteTab(tabId, msg.dest || "tab", msg.groupId);
          sendResponse({ ok });
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

// promote-tab command: promote the active tab if its window is ephemeral.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "promote-tab") return;
  const tabs = await safe(chrome.tabs.query({ active: true, lastFocusedWindow: true }), "tabs.query command");
  const tab = tabs && tabs[0];
  if (!tab || tab.windowId === undefined) return;
  if (!(await isEphemeralWindow(tab.windowId))) return;
  await promoteTab(tab.id, "tab");
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
});

// Top-level: runs on every service-worker wake. Opening the port here is what
// keeps this worker alive between events.
connectNative();
