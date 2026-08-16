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

function sandbox({ chrome, indexedDB }) {
  return {
    chrome,
    indexedDB,
    console: quietConsole,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    Date,
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
  const context = vm.createContext(sandbox({ chrome, indexedDB }));
  vm.runInContext(fs.readFileSync(WORKER_PATH, "utf8"), context, { filename: WORKER_PATH });
  await flush();
  const state = chromeState(chrome);
  return {
    chrome,
    indexedDB,
    workerPath: WORKER_PATH,
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
    menus() {
      return [...state.menus.values()];
    },
    captures() {
      return indexedDB.store("lil-sleep", "captures");
    },
    flush,
    async deliver(msg) {
      await state.deliver(msg);
      await flush();
    },
    async message(msg, sender = {}) {
      const reply = await state.sendRuntimeMessage(msg, sender);
      await flush();
      return reply;
    },
    async installed() {
      await state.events.runtime.onInstalled.fire({ reason: "install" });
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
