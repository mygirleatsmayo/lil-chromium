/**
 * Deterministic fake Chrome MV3 surface for the production service worker.
 * Records windows/tabs mutations on a journal; native-port traffic is inspectable.
 * Event listeners are awaited so tests observe the worker's async handlers.
 */

const EXTENSION_ID = "oofeehjoocddelicpmnpbafmbalaakge";
const WINDOW_ID_NONE = -1;
const DEFAULT_DISPLAY = {
  id: "primary",
  isPrimary: true,
  workArea: { left: 0, top: 0, width: 1920, height: 1080 },
};
const TINY_JPEG = "data:image/jpeg;base64,QQ==";

const states = new WeakMap();

export function chromeState(chrome) {
  return states.get(chrome);
}

function makeEvent() {
  const listeners = [];
  return {
    addListener(fn) {
      listeners.push(fn);
    },
    async fire(...args) {
      await Promise.all(listeners.map((fn) => Promise.resolve().then(() => fn(...args))));
    },
    get _listeners() {
      return listeners;
    },
  };
}

function snapshotTab(tab) {
  return { ...tab };
}

function snapshotWindow(win, tabs) {
  return {
    id: win.id,
    type: win.type,
    left: win.left,
    top: win.top,
    width: win.width,
    height: win.height,
    focused: win.focused,
    incognito: win.incognito,
    tabs: win.tabIds.map((id) => snapshotTab(tabs.get(id))),
  };
}

export function createChrome(options = {}) {
  const journal = [];
  const storage = { ...(options.storage || {}) };
  const windows = new Map();
  const tabs = new Map();
  const menus = new Map();
  const alarms = new Map();
  const history = [...(options.history || [])];
  const tabGroups = [...(options.tabGroups || [])];
  const displays = options.displays ? [...options.displays] : [DEFAULT_DISPLAY];
  let incognitoAllowed = options.incognitoAllowed !== false;
  let lastError = undefined;
  let nextWindowId = 1;
  let nextTabId = 1;

  const events = {
    runtime: { onMessage: makeEvent(), onStartup: makeEvent(), onInstalled: makeEvent() },
    windows: { onFocusChanged: makeEvent(), onBoundsChanged: makeEvent(), onRemoved: makeEvent() },
    tabs: { onUpdated: makeEvent(), onActivated: makeEvent() },
    webNavigation: { onCreatedNavigationTarget: makeEvent() },
    alarms: { onAlarm: makeEvent() },
    contextMenus: { onClicked: makeEvent() },
    commands: { onCommand: makeEvent() },
  };

  const native = {
    name: null,
    outgoing: [],
    incoming: [],
    disconnect: [],
    async deliver(msg) {
      const copy = structuredClone(msg);
      for (const fn of native.incoming) await fn(copy);
    },
    disconnectPort() {
      for (const fn of native.disconnect) fn();
    },
  };

  function record(op, detail) {
    journal.push({ op, ...detail });
  }

  function rejectMissing(kind, id) {
    return Promise.reject(new Error(`No ${kind} with id ${id}`));
  }

  function focusExclusive(id) {
    for (const w of windows.values()) w.focused = w.id === id;
  }

  function addTab({ windowId, url, active = true, openerTabId, incognito = false }) {
    const id = nextTabId++;
    const tab = {
      id,
      windowId,
      url,
      active,
      openerTabId,
      audible: false,
      discarded: false,
      frozen: false,
      incognito,
    };
    tabs.set(id, tab);
    return tab;
  }

  function closeWindowIfEmpty(windowId) {
    const win = windows.get(windowId);
    if (!win || win.tabIds.length) return Promise.resolve();
    windows.delete(windowId);
    record("windows.remove", { windowId });
    return events.windows.onRemoved.fire(windowId);
  }

  async function createWindow(opts = {}) {
    if (typeof opts.tabId === "number" && !tabs.has(opts.tabId)) {
      return rejectMissing("tab", opts.tabId);
    }
    const id = nextWindowId++;
    const focused = opts.focused !== false;
    if (focused) {
      for (const w of windows.values()) w.focused = false;
    }
    const win = {
      id,
      type: opts.type || "normal",
      left: opts.left ?? 0,
      top: opts.top ?? 0,
      width: opts.width ?? 1100,
      height: opts.height ?? 800,
      focused,
      incognito: !!opts.incognito,
      tabIds: [],
    };
    windows.set(id, win);

    if (typeof opts.tabId === "number") {
      const tab = tabs.get(opts.tabId);
      const oldId = tab.windowId;
      const old = windows.get(oldId);
      if (old) old.tabIds = old.tabIds.filter((tid) => tid !== tab.id);
      tab.windowId = id;
      tab.incognito = win.incognito;
      win.tabIds.push(tab.id);
      await closeWindowIfEmpty(oldId);
    } else if (typeof opts.url === "string") {
      const tab = addTab({ windowId: id, url: opts.url, active: true, incognito: win.incognito });
      win.tabIds.push(tab.id);
    }

    record("windows.create", { windowId: id, create: { ...opts } });
    if (win.focused) await events.windows.onFocusChanged.fire(id);
    return snapshotWindow(win, tabs);
  }

  const state = {
    journal,
    storage,
    windows,
    tabs,
    menus,
    alarms,
    history,
    tabGroups,
    native,
    events,
    listWindows() {
      return [...windows.values()].map((w) => snapshotWindow(w, tabs));
    },
    async deliver(msg) {
      await native.deliver(msg);
    },
    async sendRuntimeMessage(msg, sender = {}) {
      const fns = events.runtime.onMessage._listeners;
      if (!fns.length) return undefined;
      const copy = structuredClone(msg);
      const replies = await Promise.all(
        fns.map(
          (fn) =>
            new Promise((resolve) => {
              let done = false;
              const sendResponse = (value) => {
                if (done) return;
                done = true;
                resolve(value);
              };
              const keep = fn(copy, sender, sendResponse);
              if (keep !== true && !done) resolve(undefined);
            })
        )
      );
      return replies[0];
    },
  };

  const chrome = {
    windows: {
      WINDOW_ID_NONE,
      create: (opts) => createWindow(opts),
      async update(id, opts = {}) {
        const win = windows.get(id);
        if (!win) return rejectMissing("window", id);
        const boundsKeys = ["left", "top", "width", "height"];
        const boundsChanged = boundsKeys.some((k) => opts[k] !== undefined);
        if (opts.focused === true) focusExclusive(id);
        if (opts.focused === false) win.focused = false;
        for (const k of boundsKeys) {
          if (opts[k] !== undefined) win[k] = opts[k];
        }
        record("windows.update", { windowId: id, update: { ...opts } });
        if (opts.focused === true) await events.windows.onFocusChanged.fire(id);
        if (boundsChanged) await events.windows.onBoundsChanged.fire(snapshotWindow(win, tabs));
        return snapshotWindow(win, tabs);
      },
      async get(id) {
        const win = windows.get(id);
        if (!win) return rejectMissing("window", id);
        return snapshotWindow(win, tabs);
      },
      async getAll(query = {}) {
        let list = [...windows.values()];
        if (query.windowTypes) list = list.filter((w) => query.windowTypes.includes(w.type));
        return list.map((w) => snapshotWindow(w, tabs));
      },
      async getLastFocused(query = {}) {
        let list = [...windows.values()];
        if (query.windowTypes) list = list.filter((w) => query.windowTypes.includes(w.type));
        const focused = list.find((w) => w.focused);
        const pick = focused || list[list.length - 1];
        if (!pick) return rejectMissing("window", "last-focused");
        return snapshotWindow(pick, tabs);
      },
      async remove(id) {
        if (!windows.has(id)) return rejectMissing("window", id);
        const win = windows.get(id);
        for (const tabId of [...win.tabIds]) tabs.delete(tabId);
        windows.delete(id);
        record("windows.remove", { windowId: id });
        await events.windows.onRemoved.fire(id);
      },
      onFocusChanged: events.windows.onFocusChanged,
      onBoundsChanged: events.windows.onBoundsChanged,
      onRemoved: events.windows.onRemoved,
    },
    tabs: {
      async get(id) {
        const tab = tabs.get(id);
        if (!tab) return rejectMissing("tab", id);
        return snapshotTab(tab);
      },
      async query(q = {}) {
        let list = [...tabs.values()];
        if (q.windowId !== undefined) list = list.filter((t) => t.windowId === q.windowId);
        if (q.active !== undefined) list = list.filter((t) => t.active === q.active);
        if (q.lastFocusedWindow) {
          const focused = [...windows.values()].find((w) => w.focused);
          list = focused ? list.filter((t) => t.windowId === focused.id) : [];
        }
        return list.map(snapshotTab);
      },
      async update(id, opts = {}) {
        const tab = tabs.get(id);
        if (!tab) return rejectMissing("tab", id);
        const changeInfo = {};
        if (opts.url !== undefined) {
          tab.url = opts.url;
          changeInfo.url = opts.url;
        }
        if (opts.active === true) {
          const win = windows.get(tab.windowId);
          if (win) {
            for (const tid of win.tabIds) {
              const t = tabs.get(tid);
              if (t) t.active = t.id === id;
            }
          }
          changeInfo.active = true;
        }
        record("tabs.update", { tabId: id, update: { ...opts } });
        if (Object.keys(changeInfo).length) await events.tabs.onUpdated.fire(id, changeInfo, snapshotTab(tab));
        return snapshotTab(tab);
      },
      async remove(id) {
        const tab = tabs.get(id);
        if (!tab) return rejectMissing("tab", id);
        const windowId = tab.windowId;
        const win = windows.get(windowId);
        if (win) win.tabIds = win.tabIds.filter((tid) => tid !== id);
        tabs.delete(id);
        record("tabs.remove", { tabId: id });
        await closeWindowIfEmpty(windowId);
      },
      async create(opts = {}) {
        const windowId = opts.windowId ?? [...windows.keys()].at(-1);
        if (windowId === undefined) {
          const win = await createWindow({ url: opts.url, type: "normal", focused: !!opts.active });
          const tab = tabs.get(win.tabs[0].id);
          record("tabs.create", { tabId: tab.id, create: { ...opts } });
          return snapshotTab(tab);
        }
        const win = windows.get(windowId);
        if (!win) return rejectMissing("window", windowId);
        if (opts.active) {
          for (const tid of win.tabIds) {
            const t = tabs.get(tid);
            if (t) t.active = false;
          }
        }
        const tab = addTab({
          windowId,
          url: opts.url || "about:blank",
          active: opts.active !== false,
          openerTabId: opts.openerTabId,
        });
        win.tabIds.push(tab.id);
        record("tabs.create", { tabId: tab.id, create: { ...opts } });
        return snapshotTab(tab);
      },
      async move(id, opts = {}) {
        const tab = tabs.get(id);
        if (!tab) return rejectMissing("tab", id);
        const from = tab.windowId;
        const to = opts.windowId;
        if (to !== undefined && to !== from) {
          const src = windows.get(from);
          const dst = windows.get(to);
          if (!dst) return rejectMissing("window", to);
          if (src) src.tabIds = src.tabIds.filter((tid) => tid !== id);
          dst.tabIds.push(id);
          tab.windowId = to;
          await closeWindowIfEmpty(from);
        }
        record("tabs.move", { tabId: id, move: { ...opts } });
        return snapshotTab(tab);
      },
      async reload(id) {
        if (!tabs.has(id)) return rejectMissing("tab", id);
        record("tabs.reload", { tabId: id });
      },
      async group({ tabIds, groupId }) {
        for (const id of tabIds || []) {
          const tab = tabs.get(id);
          if (tab) tab.groupId = groupId;
        }
        record("tabs.group", { tabIds, groupId });
        return groupId;
      },
      sendMessage(id, message, callback) {
        record("tabs.sendMessage", { tabId: id, message });
        if (typeof callback === "function") queueMicrotask(callback);
      },
      async captureVisibleTab(windowId, opts = {}) {
        record("tabs.captureVisibleTab", { windowId, opts: { ...opts } });
        return TINY_JPEG;
      },
      onUpdated: events.tabs.onUpdated,
      onActivated: events.tabs.onActivated,
    },
    runtime: {
      get lastError() {
        const err = lastError;
        lastError = undefined;
        return err;
      },
      connectNative(name) {
        native.name = name;
        record("runtime.connectNative", { name });
        return {
          postMessage(msg) {
            native.outgoing.push(structuredClone(msg));
          },
          onMessage: {
            addListener(fn) {
              native.incoming.push(fn);
            },
          },
          onDisconnect: {
            addListener(fn) {
              native.disconnect.push(fn);
            },
          },
        };
      },
      getURL(p) {
        const rel = String(p).replace(/^\//, "");
        return `chrome-extension://${EXTENSION_ID}/${rel}`;
      },
      onMessage: events.runtime.onMessage,
      onStartup: events.runtime.onStartup,
      onInstalled: events.runtime.onInstalled,
    },
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return { ...storage };
          if (typeof keys === "string") {
            return keys in storage ? { [keys]: storage[keys] } : {};
          }
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) if (k in storage) out[k] = storage[k];
            return out;
          }
          const out = { ...keys };
          for (const k of Object.keys(keys)) if (k in storage) out[k] = storage[k];
          return out;
        },
        async set(obj) {
          Object.assign(storage, obj);
        },
      },
    },
    history: {
      async search({ text = "", maxResults, startTime } = {}) {
        const q = String(text).toLowerCase();
        let items = history.filter((h) => {
          if (typeof startTime === "number" && typeof h.lastVisitTime === "number" && h.lastVisitTime < startTime) {
            return false;
          }
          if (!q) return true;
          return (h.url || "").toLowerCase().includes(q) || (h.title || "").toLowerCase().includes(q);
        });
        if (typeof maxResults === "number") items = items.slice(0, maxResults);
        return items.map((h) => ({ ...h }));
      },
    },
    system: {
      display: {
        async getInfo() {
          return displays.map((d) => ({ ...d, workArea: { ...d.workArea } }));
        },
      },
    },
    extension: {
      async isAllowedIncognitoAccess() {
        return incognitoAllowed;
      },
    },
    alarms: {
      async get(name) {
        return alarms.get(name) || undefined;
      },
      async create(name, info = {}) {
        alarms.set(name, { name, ...info });
        record("alarms.create", { name, info: { ...info } });
      },
      onAlarm: events.alarms.onAlarm,
    },
    contextMenus: {
      removeAll(cb) {
        menus.clear();
        record("contextMenus.removeAll", {});
        if (typeof cb === "function") queueMicrotask(cb);
      },
      create(opts) {
        menus.set(opts.id, { visible: true, ...opts });
        record("contextMenus.create", { id: opts.id, title: opts.title });
        return opts.id;
      },
      update(id, props, cb) {
        const item = menus.get(id);
        if (!item) lastError = { message: `Can't find menu item with id ${id}` };
        else Object.assign(item, props);
        if (typeof cb === "function") queueMicrotask(cb);
      },
      onClicked: events.contextMenus.onClicked,
    },
    commands: {
      onCommand: events.commands.onCommand,
    },
    tabGroups: {
      async query() {
        return tabGroups.map((g) => ({ ...g }));
      },
      async get(id) {
        const g = tabGroups.find((x) => x.id === id);
        if (!g) return rejectMissing("tab group", id);
        return { ...g };
      },
    },
    webNavigation: {
      onCreatedNavigationTarget: events.webNavigation.onCreatedNavigationTarget,
    },
  };

  states.set(chrome, state);
  return chrome;
}
