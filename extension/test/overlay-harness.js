/**
 * Load production overlay.js against a page document.
 * Linkedom builds the tree; this harness supplies Chromium-like composed
 * keyboard dispatch, focus, and a callback-style chrome.runtime so tests
 * observe the overlay/page event boundary without product hooks.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { parseHTML, Event as DOMEvent } from "linkedom";

export const OVERLAY_PATH = path.resolve(fileURLToPath(new URL("../overlay.js", import.meta.url)));

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

function unrefTimeout(fn, ms) {
  const id = setTimeout(fn, ms);
  if (typeof id === "object" && id.unref) id.unref();
  return id;
}

function unrefInterval(fn, ms) {
  const id = setInterval(fn, ms);
  if (typeof id === "object" && id.unref) id.unref();
  return id;
}

export async function flush(turns = 8) {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function captureFlag(options) {
  return options === true || !!(options && options.capture);
}

class KeyboardEvent extends DOMEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.key = init.key || "";
    this.code = init.code || "";
    this.metaKey = !!init.metaKey;
    this.shiftKey = !!init.shiftKey;
    this.altKey = !!init.altKey;
    this.ctrlKey = !!init.ctrlKey;
    this.repeat = !!init.repeat;
    this.isComposing = !!init.isComposing;
  }
}

class MouseEvent extends DOMEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.clientX = init.clientX || 0;
    this.clientY = init.clientY || 0;
    this.metaKey = !!init.metaKey;
  }
}

function installComposedDispatch(window) {
  const records = new WeakMap();

  function listenersOf(node) {
    if (!records.has(node)) records.set(node, []);
    return records.get(node);
  }

  function composedPathFrom(start) {
    const path = [];
    const seen = new Set();
    let node = start;
    while (node && !seen.has(node)) {
      seen.add(node);
      path.push(node);
      if (node.parentNode) node = node.parentNode;
      else if (node.host) node = node.host;
      else if (node.nodeType === 9) node = window;
      else break;
    }
    return path;
  }

  function wrap(target) {
    target.addEventListener = function (type, fn, options) {
      listenersOf(this).push({ type, fn, capture: captureFlag(options) });
    };
    target.removeEventListener = function (type, fn, options) {
      const capture = captureFlag(options);
      const list = listenersOf(this);
      const i = list.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
      if (i >= 0) list.splice(i, 1);
    };
    target.dispatchEvent = function (event) {
      const path = composedPathFrom(this);
      event._path = path.map((currentTarget) => ({ currentTarget, target: this }));
      event.target = this;
      event.defaultPrevented = !!event.defaultPrevented;
      event.cancelBubble = false;
      event._stopImmediatePropagationFlag = false;

      const invoke = (node, capture) => {
        if (event._stopImmediatePropagationFlag) return;
        if (!capture && event.cancelBubble) return;
        const list = listenersOf(node).filter((l) => l.type === event.type && l.capture === capture);
        event.currentTarget = node;
        event.eventPhase =
          node === this
            ? event.AT_TARGET || 2
            : capture
              ? event.CAPTURING_PHASE || 1
              : event.BUBBLING_PHASE || 3;
        for (const { fn } of list) {
          fn.call(node, event);
          if (event._stopImmediatePropagationFlag) break;
        }
      };

      for (let i = path.length - 1; i >= 0; i--) invoke(path[i], true);
      if (!event.cancelBubble) {
        for (let i = 0; i < path.length; i++) invoke(path[i], false);
      }
      event.eventPhase = event.NONE || 0;
      return !event.defaultPrevented;
    };
  }

  wrap(window.EventTarget.prototype);
  // Linkedom lazily creates window's EventTarget on first listener access.
  void window.addEventListener;
  wrap(window);
}

function installFocus(window) {
  let active = null;
  const proto = window.HTMLElement.prototype;
  proto.focus = function focus() {
    active = this;
  };
  proto.blur = function blur() {
    if (active === this) active = null;
  };
  proto.select = function select() {};
  Object.defineProperty(window.ShadowRoot.prototype, "activeElement", {
    configurable: true,
    get() {
      return active && this.contains(active) ? active : null;
    },
  });
  Object.defineProperty(window.document, "activeElement", {
    configurable: true,
    get() {
      return active;
    },
  });
}

function defaultContext() {
  return {
    browser: "chrome",
    browserName: "Chrome",
    primaryBrowser: "helium",
    primaryBrowserName: "Helium",
    fallbackBrowser: "chrome",
    linkBehavior: "new-lil",
    ephemeralDefault: "never",
    sleep: { whitelist: [] },
    searchEngine: {
      name: "Startpage",
      template: "https://www.startpage.com/sp/search?query=%s",
    },
    hoverBar: { style: "glass", tint: null, revealHeight: 15 },
    knownBrowsers: [],
  };
}

function createChrome(options = {}) {
  const context = { ...defaultContext(), ...(options.context || {}) };
  if (options.hoverBar) context.hoverBar = { ...context.hoverBar, ...options.hoverBar };
  const messages = [];
  const runtimeListeners = [];
  const suggestions = options.omnibox || [
    { url: "https://github.com/issues", title: "Issues", host: "github.com" },
  ];

  const chrome = {
    messages,
    runtime: {
      lastError: undefined,
      sendMessage(msg, cb) {
        messages.push(msg);
        queueMicrotask(() => {
          if (!cb) return;
          if (msg.action === "isEphemeral") cb({ ephemeral: options.ephemeral !== false });
          else if (msg.action === "getContext") cb({ context });
          else if (msg.action === "omnibox") cb({ suggestions, searchEngine: context.searchEngine });
          else cb({});
        });
      },
      onMessage: {
        addListener(fn) {
          runtimeListeners.push(fn);
        },
      },
    },
    pushContext(next) {
      Object.assign(context, next);
      const msg = { action: "contextUpdate", context };
      for (const fn of runtimeListeners) fn(msg);
    },
  };
  return chrome;
}

/**
 * Mount the production overlay in a fresh page. Returns the closed shadow
 * via a harness-only attachShadow stash — overlay.js still requests closed.
 */
export async function mountOverlay(options = {}) {
  delete globalThis.__lilChromiumOverlayLoaded;
  const window = parseHTML("<!DOCTYPE html><html><head></head><body></body></html>");
  const document = window.document;
  const href = options.url || "https://example.com/docs";
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { href, protocol: "https:", host: "example.com", pathname: "/docs", search: "", hash: "" },
  });
  window.matchMedia = () => ({ matches: false, addEventListener() {}, media: "" });
  window.KeyboardEvent = KeyboardEvent;
  window.MouseEvent = MouseEvent;
  window.history = { back() {}, length: 1 };

  const shadows = new WeakMap();
  const nativeAttach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function attachShadow(init) {
    const root = nativeAttach.call(this, init);
    shadows.set(this, root);
    return root;
  };

  installComposedDispatch(window);
  installFocus(window);

  const chrome = createChrome(options);
  const sandbox = {
    window,
    document,
    chrome,
    location: window.location,
    history: window.history,
    navigator: window.navigator,
    console: quietConsole,
    setTimeout: unrefTimeout,
    clearTimeout,
    setInterval: unrefInterval,
    clearInterval,
    queueMicrotask,
    Event: DOMEvent,
    KeyboardEvent,
    MouseEvent,
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
    Error,
    URL,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    Infinity,
    NaN,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(OVERLAY_PATH, "utf8"), sandbox, { filename: OVERLAY_PATH });
  await flush();

  const host = [...document.documentElement.children].find((el) => shadows.has(el)) || null;
  const root = host ? shadows.get(host) : null;
  return {
    window,
    document,
    chrome,
    host,
    root,
    overlayPath: OVERLAY_PATH,
    addr: root ? root.querySelector(".addr") : null,
    omni: root ? root.querySelector(".omni") : null,
    bar: root ? root.querySelector(".bar") : null,
    urlDisplay: root ? root.querySelector(".url") : null,
    key(target, key, init = {}) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event;
    },
    flush,
  };
}
