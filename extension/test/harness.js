import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { chromeState, createChrome } from "./chrome.js";
import { createIndexedDB } from "./indexeddb.js";

export const WORKER_PATH = path.resolve(fileURLToPath(new URL("../background.js", import.meta.url)));

const quietConsole = {
  log() {},
  info() {},
  debug() {},
  warn(...args) {
    console.warn(...args);
  },
  error(...args) {
    console.error(...args);
  },
};

export async function flush(turns = 8) {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Manually advanced clock for the worker sandbox. `Date.now()` reads it and
 * `setTimeout`/`clearTimeout` queue on it, so tests step time forward instead
 * of sleeping against the wall clock. advance() fires due timers in time
 * order, flushing promise continuations after each one.
 */
export function createClock(start = 1_700_000_000_000) {
  let now = start;
  let seq = 0;
  const timers = new Map();
  const clock = {
    now: () => now,
    setTimeout(fn, ms = 0) {
      const id = ++seq;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        let nextId = null;
        let nextAt = Infinity;
        for (const [id, t] of timers) {
          if (t.at <= target && t.at < nextAt) {
            nextAt = t.at;
            nextId = id;
          }
        }
        if (nextId === null) break;
        const t = timers.get(nextId);
        timers.delete(nextId);
        now = t.at;
        t.fn();
        await flush();
      }
      now = target;
    },
  };
  return clock;
}

function sandbox({ chrome, indexedDB, clock }) {
  return {
    chrome,
    indexedDB,
    console: quietConsole,
    setTimeout: clock ? clock.setTimeout : setTimeout,
    clearTimeout: clock ? clock.clearTimeout : clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    // The worker only ever reads Date.now(); a clocked boot swaps in the
    // manual clock, everything else keeps the real Date.
    Date: clock ? { now: clock.now } : Date,
    Math,
    JSON,
    Promise,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Symbol,
    Error,
    TypeError,
    RangeError,
    URIError,
    URL,
    URLSearchParams,
    Blob,
    Uint8Array,
    ArrayBuffer,
    atob,
    btoa,
    TextEncoder,
    TextDecoder,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    Infinity,
    NaN,
  };
}

/**
 * Load the production service worker into a fresh VM against a fake Chrome.
 * Top-level connectNative / ensureSweepAlarm run exactly as they do in Chromium.
 */
export async function boot(options = {}) {
  const chrome = createChrome(options);
  const indexedDB = createIndexedDB();
  const clock = options.clock === true ? createClock(options.clockStart) : null;
  const context = vm.createContext(sandbox({ chrome, indexedDB, clock }));
  vm.runInContext(fs.readFileSync(WORKER_PATH, "utf8"), context, { filename: WORKER_PATH });
  await flush();
  const state = chromeState(chrome);
  return {
    chrome,
    indexedDB,
    workerPath: WORKER_PATH,
    clock,
    journal: () => state.journal,
    registry() {
      return state.storage.ephemeralWindows || {};
    },
    outgoing() {
      return state.native.outgoing;
    },
    nativeName() {
      return state.native.name;
    },
    windows() {
      return state.listWindows();
    },
    async blurBrowser() {
      await state.blurBrowser();
      await flush();
    },
    menus() {
      return [...state.menus.values()];
    },
    sessionHistory(tabId) {
      return state.sessionHistory(tabId);
    },
    async setTabState(tabId, patch) {
      const tab = await state.setTabState(tabId, patch);
      await flush();
      return tab;
    },
    captures() {
      return indexedDB.store("lil-sleep", "captures");
    },
    flush,
    async deliver(msg) {
      await state.deliver(msg);
      await flush();
    },
    async disconnect() {
      state.native.disconnectPort();
      await flush();
    },
    async message(msg, sender = {}) {
      const reply = await state.sendRuntimeMessage(msg, sender);
      await flush();
      return reply;
    },
    // Send a runtime message without awaiting the reply, so a test can drive
    // the manual clock while the worker's handler is still pending.
    messageLater(msg, sender = {}) {
      return state.sendRuntimeMessage(msg, sender);
    },
    async installed() {
      await state.events.runtime.onInstalled.fire({ reason: "install" });
      await flush();
    },
    async startup() {
      await state.events.runtime.onStartup.fire();
      await flush();
    },
    async alarm(name = "lil-sweep") {
      await state.events.alarms.onAlarm.fire({ name });
      await flush();
    },
    async clickMenu(menuItemId, tab, info = {}) {
      await state.events.contextMenus.onClicked.fire({ menuItemId, ...info }, tab);
      await flush();
    },
    async createdNavigationTarget(details) {
      await state.events.webNavigation.onCreatedNavigationTarget.fire(details);
      await flush();
    },
  };
}
