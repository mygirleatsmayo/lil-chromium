/**
 * Load production sleep.js against the real sleep.html document.
 * Linkedom builds the tree; the harness supplies the extension-page boundary
 * (runtime wake replies, storage.local registry, IndexedDB captures) and a
 * recordable location so tests observe the nap page's fallback navigation and
 * cleanup without a browser. Timers are captured, never run: tests fire
 * deadlines explicitly and can prove what does not happen at a deadline.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { parseHTML, Event as DOMEvent } from "linkedom";
import { createIndexedDB } from "./indexeddb.js";

export const SLEEP_PAGE_PATH = path.resolve(fileURLToPath(new URL("../sleep.js", import.meta.url)));
const SLEEP_HTML_PATH = path.resolve(fileURLToPath(new URL("../sleep.html", import.meta.url)));
const EXTENSION_ID = "oofeehjoocddelicpmnpbafmbalaakge";

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
 * Mount the production nap page. options:
 *   captureKey / originalUrl / originalTitle / tint — nap URL query inputs
 *   windowId — registry key of the napping lil (its entry is seeded napping)
 *   reply — "ok" | "fail" | "error" | "hang" | "throw": the worker's answer
 *   hangStorage — storage.local.get never settles (P4 bound)
 */
export async function mountSleepPage(options = {}) {
  const captureKey = options.captureKey || "7-1700000000000";
  const originalUrl = options.originalUrl || "https://example.com/docs";
  const originalTitle = options.originalTitle || "Example Docs";
  const tint = options.tint || "purple";
  const windowId = options.windowId || 7;
  const replyMode = options.reply || "ok";
  const hangStorage = !!options.hangStorage;

  const window = parseHTML(fs.readFileSync(SLEEP_HTML_PATH, "utf8"));
  const document = window.document;

  const storage = {
    ephemeralWindows: {
      [String(windowId)]: {
        url: originalUrl,
        bounds: { left: 10, top: 10, width: 1100, height: 800 },
        expiry: "never",
        lastInteraction: 1700000000000,
        slept: true,
        sleepCaptureKey: captureKey,
        originalUrl,
        originalTitle,
      },
    },
  };
  const indexedDB = createIndexedDB();
  const wakeMessages = [];
  let navigatedTo = null;
  const timers = new Map();
  let nextTimerId = 1;

  const query = new URLSearchParams({ k: captureKey, u: originalUrl, t: originalTitle, tint });
  const location = {
    href: `chrome-extension://${EXTENSION_ID}/sleep.html?${query.toString()}`,
    search: `?${query.toString()}`,
    replace(url) {
      navigatedTo = url;
    },
  };

  const runtime = {
    lastError: undefined,
    sendMessage(msg, cb) {
      wakeMessages.push(structuredClone(msg));
      if (replyMode === "throw") throw new Error("Extension context invalidated.");
      if (replyMode === "hang") return; // the worker never answers
      queueMicrotask(() => {
        if (replyMode === "error") {
          runtime.lastError = { message: "Could not establish connection. Receiving end does not exist." };
          cb(undefined);
          runtime.lastError = undefined;
        } else if (replyMode === "fail") {
          cb({ ok: false });
        } else {
          cb({ ok: true });
        }
      });
    },
  };

  const chrome = {
    runtime,
    storage: {
      local: {
        async get(keys) {
          if (hangStorage) return new Promise(() => {});
          if (keys == null) return { ...storage };
          if (typeof keys === "string") return keys in storage ? { [keys]: storage[keys] } : {};
          return {};
        },
        async set(obj) {
          Object.assign(storage, obj);
        },
      },
    },
  };

  const sandbox = {
    window,
    document,
    location,
    chrome,
    indexedDB,
    console: quietConsole,
    setTimeout(fn, ms = 0) {
      const id = nextTimerId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    queueMicrotask,
    // The page only builds object URLs and parses query strings.
    URL: { createObjectURL: () => "blob:stub", revokeObjectURL() {} },
    URLSearchParams,
    Date,
    Math,
    JSON,
    Promise,
    Map,
    Set,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    Infinity,
    NaN,
  };
  // A capture blob sits under the page's key before load, as nap entry left
  // it. Seeded through the IDB API so the db/store exist when the page reads.
  await new Promise((resolve, reject) => {
    const req = indexedDB.open("lil-sleep", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("captures");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction("captures", "readwrite");
      tx.objectStore("captures").put(new Blob([1, 2, 3], { type: "image/jpeg" }), captureKey);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
  });

  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SLEEP_PAGE_PATH, "utf8"), sandbox, { filename: SLEEP_PAGE_PATH });
  await flush();

  return {
    window,
    document,
    chrome,
    indexedDB,
    sleepPath: SLEEP_PAGE_PATH,
    wakeMessages,
    navigatedTo() {
      return navigatedTo;
    },
    registry() {
      return storage.ephemeralWindows || {};
    },
    captures() {
      return indexedDB.store("lil-sleep", "captures");
    },
    scheduledDelays() {
      return [...timers.values()].map((t) => t.ms);
    },
    // Run and drop every captured timer whose delay matches pred.
    fireTimers(pred) {
      for (const [id, t] of [...timers]) {
        if (pred(t.ms)) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    click() {
      document.dispatchEvent(new DOMEvent("click", { bubbles: true }));
    },
    flush,
  };
}
