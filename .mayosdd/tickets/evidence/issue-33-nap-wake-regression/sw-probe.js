/**
 * Issue #33 service-worker probe. Paste into Helium
 * chrome://extensions → lil chromium → Inspect views: service worker.
 * Does not wake anything. After you click the napping lil, run:
 *   copy(JSON.stringify(await __issue33.dump(), null, 2))
 * and save as probe.json for live-wake-trace.mjs compare --probe.
 */
(function installIssue33Probe() {
  if (globalThis.__issue33 && globalThis.__issue33.installed) {
    console.log("[issue-33] probe already installed");
    return globalThis.__issue33;
  }
  const origCreate = chrome.tabs.create.bind(chrome.tabs);
  const origRemove = chrome.tabs.remove.bind(chrome.tabs);
  const origUpdate = chrome.tabs.update.bind(chrome.tabs);
  const events = [];
  function rec(e) {
    const row = { t: Date.now(), ...e };
    events.push(row);
    console.log("[issue-33]", JSON.stringify(row));
  }
  chrome.tabs.create = function (opts) {
    rec({
      op: "tabs.create.request",
      requestedWindowId: opts && opts.windowId,
      url: opts && opts.url,
      active: opts && opts.active,
    });
    return origCreate(opts).then((tab) => {
      rec({
        op: "tabs.create",
        requestedWindowId: opts && opts.windowId,
        returnedTabId: tab && tab.id,
        returnedWindowId: tab && tab.windowId,
        url: opts && opts.url,
        active: opts && opts.active,
      });
      return tab;
    });
  };
  chrome.tabs.remove = function (id) {
    rec({ op: "tabs.remove", tabId: id });
    return origRemove(id);
  };
  chrome.tabs.update = function (id, opts) {
    rec({ op: "tabs.update", tabId: id, update: opts });
    return origUpdate(id, opts);
  };
  if (chrome.windows && chrome.windows.onRemoved) {
    chrome.windows.onRemoved.addListener((windowId) => {
      rec({ op: "windows.onRemoved", windowId });
    });
  }
  globalThis.__issue33 = {
    installed: true,
    events,
    async dump() {
      const windows = await chrome.windows.getAll({ populate: true });
      let focused = null;
      try {
        focused = await chrome.windows.getLastFocused();
      } catch (_) {}
      const storage = await chrome.storage.local.get("ephemeralWindows");
      return {
        dumpedAt: new Date().toISOString(),
        events,
        windows,
        focusedWindowId: focused && focused.id,
        registry: storage.ephemeralWindows || {},
      };
    },
  };
  rec({ op: "probe-ready" });
  return globalThis.__issue33;
})();
