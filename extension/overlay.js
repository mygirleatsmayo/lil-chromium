// lil-chromium overlay content script (v0.3).
//
// Runs on every http/https page. Asks the SW whether this tab lives in a lil
// (ephemeral popup window); if not, it does almost nothing (normal browsing must
// stay untouched, aside from silent form-dirty tracking which the Lil Nap sweep
// needs — reported only for lils via the SW's per-tab flag). If it is a lil, it
// mounts a HOVER-REVEAL top bar in a closed shadow DOM with: back, an editable
// address field carrying an omnibox suggestions dropdown and an inset copy-URL
// control, reload, "Open in {Primary browser}" promote, and a caret menu
// (promote targets, host groups, other browsers, Keep/expiry, Let This Lil Nap,
// Reopen incognito, Settings, Close). Every functional glyph comes from the
// bundled Material Symbols Rounded set — see the icon system below.

(() => {
  // Guard against double injection (SPA re-inject, doc replacement, etc.).
  if (window.__lilChromiumOverlayLoaded) return;
  window.__lilChromiumOverlayLoaded = true;

  const GROUP_COLORS = {
    grey: "#5f6368",
    blue: "#1a73e8",
    red: "#d93025",
    yellow: "#f9ab00",
    green: "#188038",
    pink: "#d01884",
    purple: "#a142f4",
    cyan: "#007b83",
    orange: "#fa903e",
  };

  // --- Functional icon system --------------------------------------------
  // Official Material Symbols Rounded (Apache-2.0), weight 400 / grade 0 /
  // optical size 24, vendored verbatim in extension/assets/material-symbols/.
  // One shared 24-unit grid and one `.ico` class give every control the same
  // optical size, weight, alignment, and currentColor tint — the normalization
  // lives in the family and the stylesheet, never in per-button exceptions.
  // Inlined rather than loaded as a font: Chromium ignores @font-face inside a
  // closed shadow root, and inline paths inherit the bar's colour for free.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICON_VIEWBOX = "0 -960 960 960";
  const ICON_PATHS = {
    arrow_back:
      "m313-440 196 196q12 12 11.5 28T508-188q-12 11-28 11.5T452-188L188-452q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l264-264q11-11 27.5-11t28.5 11q12 12 12 28.5T508-715L313-520h447q17 0 28.5 11.5T800-480q0 17-11.5 28.5T760-440H313Z",
    refresh:
      "M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-70q0-17 11.5-28.5T760-800q17 0 28.5 11.5T800-760v200q0 17-11.5 28.5T760-520H560q-17 0-28.5-11.5T520-560q0-17 11.5-28.5T560-600h128q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q68 0 124.5-34.5T692-367q8-14 22.5-19.5t29.5-.5q16 5 23 21t-1 30q-41 80-117 128t-169 48Z",
    link:
      "M280-280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h120q17 0 28.5 11.5T440-640q0 17-11.5 28.5T400-600H280q-50 0-85 35t-35 85q0 50 35 85t85 35h120q17 0 28.5 11.5T440-320q0 17-11.5 28.5T400-280H280Zm80-160q-17 0-28.5-11.5T320-480q0-17 11.5-28.5T360-520h240q17 0 28.5 11.5T640-480q0 17-11.5 28.5T600-440H360Zm200 160q-17 0-28.5-11.5T520-320q0-17 11.5-28.5T560-360h120q50 0 85-35t35-85q0-50-35-85t-85-35H560q-17 0-28.5-11.5T520-640q0-17 11.5-28.5T560-680h120q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H560Z",
    check:
      "m382-354 339-339q12-12 28-12t28 12q12 12 12 28.5T777-636L410-268q-12 12-28 12t-28-12L182-440q-12-12-11.5-28.5T183-497q12-12 28.5-12t28.5 12l142 143Z",
    expand_more:
      "M480-362q-8 0-15-2.5t-13-8.5L268-557q-11-11-11-28t11-28q11-11 28-11t28 11l156 156 156-156q11-11 28-11t28 11q11 11 11 28t-11 28L508-373q-6 6-13 8.5t-15 2.5Z",
    search:
      "M380-320q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l224 224q11 11 11 28t-11 28q-11 11-28 11t-28-11L532-372q-30 24-69 38t-83 14Zm0-80q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z",
  };

  // Build one decorative glyph. The control keeps the accessible name; the
  // icon is hidden from assistive technology and never a focus stop.
  function icon(name, extraClass) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", extraClass ? "ico " + extraClass : "ico");
    svg.setAttribute("viewBox", ICON_VIEWBOX);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICON_PATHS[name]);
    svg.appendChild(path);
    return svg;
  }

  // Swap a control's glyph in place, leaving its accessible name untouched.
  function setIcon(el, name) {
    el.textContent = "";
    el.appendChild(icon(name));
  }

  const REVEAL_DELAY_MS = 80;
  const HIDE_DELAY_MS = 300;
  const SLIDE_MS = 160;
  // Fallback only until the worker's context arrives; the live value is
  // config hoverBar.revealHeight, clamped 0..48 by the writer (PROTOCOL.md).
  const DEFAULT_REVEAL_PX = 15;
  const POLL_MS = 500;
  const OMNIBOX_DEBOUNCE_MS = 120;
  const COPY_TICK_MS = 1200;
  const INTERACTION_DEBOUNCE_MS = 30000; // report interaction at most every 30s
  const FORM_DIRTY_DEBOUNCE_MS = 500;

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (resp) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(resp);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function fire(message) {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch (_) {
      /* context invalidated */
    }
  }

  async function init() {
    const resp = await send({ action: "isEphemeral" });
    if (!resp || !resp.ephemeral) return; // normal window: stay invisible
    startFormDirtyTracking();
    startInteractionReporting();
    listenForHints();
    mountUI();
  }

  // =========================================================================
  // INTERACTION REPORTING — refresh the lil's lastInteraction (ephemerality).
  // Debounced to at most one message per INTERACTION_DEBOUNCE_MS.
  // =========================================================================
  function startInteractionReporting() {
    let last = 0;
    const report = () => {
      const now = Date.now();
      if (now - last < INTERACTION_DEBOUNCE_MS) return;
      last = now;
      fire({ action: "interaction" });
    };
    document.addEventListener("pointerdown", report, true);
    document.addEventListener("keydown", report, true);
    document.addEventListener("scroll", report, true);
    // Report once up front so a freshly opened lil counts as interacted-with.
    fire({ action: "interaction" });
  }

  // =========================================================================
  // FORM-DIRTY TRACKING — feeds the sleep sweep's formGuard (research §7).
  //
  // On first beforeinput, snapshot defaults; track a Set of modified elements on
  // input (value vs defaultValue, checked vs defaultChecked, select
  // defaultSelected, contenteditable textContent); drop an element when it
  // returns to default; clear on submit. Report dirty boolean to the SW,
  // debounced, ONLY on transitions.
  // =========================================================================
  function startFormDirtyTracking() {
    const dirty = new Set();
    let snapshotted = false;
    let reportedDirty = false;
    let reportTimer = null;
    const ceDefaults = new WeakMap(); // contenteditable → default textContent

    function isDefault(el) {
      const tag = el.tagName;
      if (tag === "INPUT") {
        const type = (el.type || "").toLowerCase();
        if (type === "checkbox" || type === "radio") return el.checked === el.defaultChecked;
        return el.value === el.defaultValue;
      }
      if (tag === "TEXTAREA") return el.value === el.defaultValue;
      if (tag === "SELECT") {
        for (const opt of el.options) {
          if (opt.selected !== opt.defaultSelected) return false;
        }
        return true;
      }
      if (el.isContentEditable) {
        const def = ceDefaults.has(el) ? ceDefaults.get(el) : "";
        return el.textContent === def;
      }
      return true;
    }

    function snapshotContentEditable() {
      // Snapshot current contenteditable text as the "default" baseline once.
      const nodes = document.querySelectorAll("[contenteditable]");
      nodes.forEach((n) => {
        if (!ceDefaults.has(n)) ceDefaults.set(n, n.textContent);
      });
    }

    function scheduleReport() {
      const nowDirty = dirty.size > 0;
      if (nowDirty === reportedDirty) return; // only on transitions
      clearTimeout(reportTimer);
      reportTimer = setTimeout(() => {
        reportedDirty = dirty.size > 0;
        fire({ action: "formDirty", dirty: reportedDirty });
      }, FORM_DIRTY_DEBOUNCE_MS);
    }

    document.addEventListener(
      "beforeinput",
      () => {
        if (!snapshotted) {
          snapshotted = true;
          snapshotContentEditable();
        }
      },
      true
    );

    document.addEventListener(
      "input",
      (e) => {
        const el = e.target;
        if (!el || !el.tagName) return;
        const tracked =
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable;
        if (!tracked) return;
        if (isDefault(el)) dirty.delete(el);
        else dirty.add(el);
        scheduleReport();
      },
      true
    );

    // selects fire "change" not always "input" for keyboard selection.
    document.addEventListener(
      "change",
      (e) => {
        const el = e.target;
        if (!el || el.tagName !== "SELECT") return;
        if (isDefault(el)) dirty.delete(el);
        else dirty.add(el);
        scheduleReport();
      },
      true
    );

    document.addEventListener(
      "submit",
      () => {
        dirty.clear();
        scheduleReport();
      },
      true
    );
  }

  // =========================================================================
  // INCOGNITO HINT — one-shot toast when an incognito lil fell back to normal.
  // =========================================================================
  let showToastFn = null; // set by mountUI

  function listenForHints() {
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.action === "incognitoHint" && showToastFn) {
          showToastFn(
            "Incognito lils need “Allow in Incognito” — chrome://extensions → lil-chromium → Details"
          );
        }
      });
    } catch (_) {
      /* context invalidated */
    }
    // Also poll for a queued one-shot in case the message raced our mount.
    send({ action: "pendingIncognitoHint" }).then((resp) => {
      if (resp && resp.hint && showToastFn) {
        showToastFn(
          "Incognito lils need “Allow in Incognito” — chrome://extensions → lil-chromium → Details"
        );
      }
    });
  }

  function mountUI() {
    let context = {
      browser: "chrome",
      browserName: "Chrome",
      primaryBrowser: "chrome",
      primaryBrowserName: "Chrome",
      fallbackBrowser: "chrome",
      linkBehavior: "new-lil",
      ephemeralDefault: "never",
      sleep: { whitelist: [] },
      searchEngine: { name: "Startpage", template: "https://www.startpage.com/sp/search?query=%s" },
      hoverBar: { style: "glass", tint: null, revealHeight: DEFAULT_REVEAL_PX },
      knownBrowsers: [],
    };
    let lilExpiry = "never"; // per-lil override

    const host = document.createElement("div");
    host.style.cssText =
      "all: initial; position: fixed; top: 0; left: 0; width: 100%; height: 0; z-index: 2147483647; pointer-events: none;";
    (document.documentElement || document.body).appendChild(host);
    const root = host.attachShadow({ mode: "closed" });

    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; margin: 0; padding: 0; }

        /* Data-driven theming via custom properties. Defaults = glass (light).
           mountUI flips these for solid style + dark scheme + optional tint. */
        .wrap {
          --bar-bg: rgba(255, 255, 255, 0.72);
          --bar-blur: blur(20px) saturate(1.4);
          --bar-border: 0.5px solid rgba(0, 0, 0, 0.14);
          --fg: #1c1c1e;
          --hover: rgba(0, 0, 0, 0.08);
          --field-bg: rgba(0, 0, 0, 0.06);
          --field-bg-focus: rgba(0, 0, 0, 0.1);
          --placeholder: rgba(0, 0, 0, 0.4);
          --menu-bg: rgba(250, 250, 250, 0.96);
          --menu-shadow: 0 8px 28px rgba(0, 0, 0, 0.22), 0 0 0 0.5px rgba(0, 0, 0, 0.1);
          --sep: rgba(0, 0, 0, 0.12);
          --sel: rgba(0, 0, 0, 0.09);
          --ico: 18px;
        }

        .bar {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 44px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 10px;
          pointer-events: auto;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 13px;
          line-height: 1;
          background: var(--bar-bg);
          -webkit-backdrop-filter: var(--bar-blur);
          backdrop-filter: var(--bar-blur);
          border-bottom: var(--bar-border);
          color: var(--fg);
          transform: translateY(-100%);
          opacity: 0;
          transition: transform ${SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${SLIDE_MS}ms ease;
        }
        .bar.show { transform: translateY(0); opacity: 1; }
        /* Solid style: no blur on the bar itself (keeps the field glassy inset). */
        .wrap.solid .bar { -webkit-backdrop-filter: none; backdrop-filter: none; }

        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          height: 30px;
          padding: 0 10px;
          border-radius: 8px;
          cursor: pointer;
          white-space: nowrap;
          color: inherit;
          background: transparent;
          border: none;
          font: inherit;
          transition: background 120ms ease;
          user-select: none;
        }
        .btn:hover { background: var(--hover); }
        .btn.icon { width: 30px; padding: 0; flex: 0 0 auto; }
        .btn .label { font-weight: 550; letter-spacing: 0.1px; }
        .kbd { font-size: 11px; opacity: 0.55; font-variant-numeric: tabular-nums; }

        /* Every functional glyph, everywhere: one grid, one optical size, one
           tint. Menus and the omnibox step --ico down to match their 16px rows;
           nothing else may size an icon. */
        .ico {
          width: var(--ico);
          height: var(--ico);
          display: block;
          flex: 0 0 auto;
          fill: currentColor;
        }
        .omni, .menu { --ico: 16px; }

        /* Address field container (positions the omnibox dropdown and the
           Copy URL control that rides inside the field's trailing edge). */
        .addrwrap { position: relative; flex: 1 1 auto; min-width: 0; height: 30px; }
        .addrwrap .copy { position: absolute; top: 0; right: 0; }

        .addr {
          width: 100%;
          height: 30px;
          border: none;
          outline: none;
          border-radius: 8px;
          background: var(--field-bg);
          color: inherit;
          font: inherit;
          text-align: center;
          /* Trailing room for the inset Copy URL control. */
          padding: 0 34px 0 12px;
          transition: background 120ms ease;
          /* Subtle glassy inset even in solid style. */
          box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.05);
        }
        .addr:focus { background: var(--field-bg-focus); text-align: left; }
        .addr::placeholder { color: var(--placeholder); }

        .url {
          width: 100%;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0;
          border-radius: 8px;
          background: var(--field-bg);
          /* Symmetric so the collapsed URL stays centred beside Copy URL. */
          padding: 0 34px;
          cursor: text;
          overflow: hidden;
          white-space: nowrap;
          box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.05);
        }
        .url .host { font-weight: 600; }
        .url .path { opacity: 0.5; overflow: hidden; text-overflow: ellipsis; }

        .hidden { display: none !important; }

        /* Omnibox dropdown, anchored under the address field. */
        .omni {
          position: absolute;
          top: 36px;
          left: 0;
          right: 0;
          background: var(--menu-bg);
          -webkit-backdrop-filter: blur(20px) saturate(1.4);
          backdrop-filter: blur(20px) saturate(1.4);
          border-radius: 11px;
          box-shadow: var(--menu-shadow);
          padding: 5px;
          display: none;
          max-height: 320px;
          overflow-y: auto;
          pointer-events: auto;
        }
        .omni.open { display: block; }
        .orow {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 7px 10px;
          border-radius: 7px;
          cursor: pointer;
          overflow: hidden;
        }
        .orow.sel { background: var(--sel); }
        .orow .fav { width: 16px; height: 16px; flex: 0 0 auto; border-radius: 3px; }
        .orow .otitle { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; }
        .orow .ohost { opacity: 0.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }

        .menu {
          position: fixed;
          top: 46px;
          right: 10px;
          min-width: 240px;
          max-width: 340px;
          background: var(--menu-bg);
          -webkit-backdrop-filter: blur(20px) saturate(1.4);
          backdrop-filter: blur(20px) saturate(1.4);
          border-radius: 11px;
          box-shadow: var(--menu-shadow);
          padding: 5px;
          display: none;
          color: var(--fg);
          pointer-events: auto;
          max-height: 80vh;
          overflow-y: auto;
        }
        .menu.open { display: block; }
        .item {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 7px 10px;
          border-radius: 7px;
          cursor: pointer;
          white-space: nowrap;
        }
        .item:hover { background: var(--sel); }
        .item .check { margin-left: auto; opacity: 0.9; }
        .item .k { margin-left: auto; font-size: 11px; opacity: 0.5; font-variant-numeric: tabular-nums; }
        .sub { padding: 5px 10px 2px; font-size: 11px; opacity: 0.5; text-transform: uppercase; letter-spacing: 0.4px; }
        .foot { padding: 5px 10px 2px; font-size: 11px; opacity: 0.5; pointer-events: none; }
        .sep { height: 0.5px; background: var(--sep); margin: 5px 6px; }
        .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
        .gname { overflow: hidden; text-overflow: ellipsis; max-width: 190px; }

        /* One-shot toast (incognito hint). */
        .toast {
          position: fixed;
          top: 54px;
          left: 50%;
          transform: translateX(-50%) translateY(-8px);
          max-width: min(560px, 92vw);
          background: rgba(30, 30, 32, 0.96);
          color: #f2f2f7;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 13px;
          line-height: 1.4;
          padding: 12px 16px;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
          pointer-events: auto;
          opacity: 0;
          transition: opacity 200ms ease, transform 200ms ease;
          z-index: 2;
        }
        .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

        @media (prefers-color-scheme: dark) {
          .wrap {
            --bar-bg: rgba(30, 30, 32, 0.72);
            --bar-border: 0.5px solid rgba(255, 255, 255, 0.14);
            --fg: #f2f2f7;
            --hover: rgba(255, 255, 255, 0.12);
            --field-bg: rgba(255, 255, 255, 0.1);
            --field-bg-focus: rgba(255, 255, 255, 0.16);
            --placeholder: rgba(255, 255, 255, 0.45);
            --menu-bg: rgba(40, 40, 42, 0.96);
            --menu-shadow: 0 8px 28px rgba(0, 0, 0, 0.5), 0 0 0 0.5px rgba(255, 255, 255, 0.12);
            --sep: rgba(255, 255, 255, 0.16);
            --sel: rgba(255, 255, 255, 0.14);
          }
          .addr, .url { box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.06); }
        }
      </style>
      <div class="wrap">
        <div class="bar" part="bar">
          <button class="btn icon back" title="Back" aria-label="Back"></button>
          <div class="addrwrap">
            <div class="url" role="button" tabindex="0" title="Click to edit"></div>
            <input class="addr hidden" type="text" spellcheck="false" autocomplete="off"
                   aria-label="Address" placeholder="Search or enter address" />
            <button class="btn icon copy" title="Copy URL" aria-label="Copy URL"></button>
            <div class="omni" role="listbox"></div>
          </div>
          <button class="btn icon reload" title="Reload" aria-label="Reload"></button>
          <button class="btn promote">
            <span class="label">Open in Chrome</span>
            <span class="kbd">⌘O</span>
          </button>
          <button class="btn icon caretbtn" aria-label="More options"></button>
        </div>
        <div class="menu" role="menu"></div>
      </div>
    `;

    const wrap = root.querySelector(".wrap");
    const bar = root.querySelector(".bar");
    const back = root.querySelector(".back");
    const urlDisplay = root.querySelector(".url");
    const addr = root.querySelector(".addr");
    const omni = root.querySelector(".omni");
    const reloadBtn = root.querySelector(".reload");
    const copyBtn = root.querySelector(".copy");
    const promoteBtn = root.querySelector(".promote");
    const promoteLabel = promoteBtn.querySelector(".label");
    const caretBtn = root.querySelector(".caretbtn");
    const menu = root.querySelector(".menu");

    setIcon(back, "arrow_back");
    setIcon(reloadBtn, "refresh");
    setIcon(copyBtn, "link");
    setIcon(caretBtn, "expand_more");

    // ---- Toast (used by the incognito hint listener). ----
    let toastEl = null;
    let toastTimer = null;
    showToastFn = (text) => {
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.className = "toast";
        wrap.appendChild(toastEl);
      }
      toastEl.textContent = text;
      // Force reflow so the transition runs on re-show.
      void toastEl.offsetWidth;
      toastEl.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove("show"), 7000);
      toastEl.addEventListener("click", () => toastEl.classList.remove("show"), { once: true });
    };

    // ---- Data-driven style application (glass vs solid + optional tint). ----
    function applyStyle() {
      const hb = context.hoverBar || {};
      const solid = hb.style === "solid";
      wrap.classList.toggle("solid", solid);
      const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (solid) {
        // Opaque adaptive title-bar tones.
        wrap.style.setProperty("--bar-bg", dark ? "#2c2c2e" : "#f2f2f4");
      } else {
        wrap.style.removeProperty("--bar-bg"); // fall back to CSS glass default
      }
      // Optional tint blended over the bar background in either style.
      if (hb.tint && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hb.tint)) {
        const rgb = hexToRgb(hb.tint);
        if (rgb) {
          const base = solid ? (dark ? "#2c2c2e" : "#f2f2f4") : dark ? "rgba(30,30,32,0.72)" : "rgba(255,255,255,0.72)";
          wrap.style.setProperty(
            "--bar-bg",
            `linear-gradient(rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.18), rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.18)), ${base}`
          );
        }
      }
    }

    function hexToRgb(hex) {
      let h = hex.replace(/^#/, "");
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      if (h.length !== 6) return null;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }

    // -----------------------------------------------------------------------
    // Reveal / hide state machine (unchanged from v2, plus omnibox pinning).
    // -----------------------------------------------------------------------
    let revealTimer = null;
    let hideTimer = null;
    let pollTimer = null;
    let visible = false;
    let cursorOverBar = false;

    function menuOpen() {
      return menu.classList.contains("open");
    }
    function omniOpen() {
      return omni.classList.contains("open");
    }
    function addrFocused() {
      return root.activeElement === addr;
    }
    function pinned() {
      return addrFocused() || menuOpen() || omniOpen() || cursorOverBar;
    }

    function reveal() {
      clearTimeout(hideTimer);
      hideTimer = null;
      if (visible) return;
      visible = true;
      bar.classList.add("show");
      renderUrl();
      startPoll();
    }

    function hide() {
      if (pinned()) return;
      clearTimeout(revealTimer);
      revealTimer = null;
      if (!visible) return;
      visible = false;
      bar.classList.remove("show");
      closeMenu();
      closeOmni();
      stopPoll();
    }

    function scheduleReveal() {
      if (visible || revealTimer) return;
      revealTimer = setTimeout(() => {
        revealTimer = null;
        reveal();
      }, REVEAL_DELAY_MS);
    }

    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = null;
        hide();
      }, HIDE_DELAY_MS);
    }

    function startPoll() {
      if (pollTimer) return;
      pollTimer = setInterval(renderUrl, POLL_MS);
    }
    function stopPoll() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    // Live reveal zone (issue #12): read the current config value on every
    // mousemove so a Settings write applies to this overlay immediately. Zero
    // disables mouse reveal (treated as never-near-top, so an already-shown
    // bar still hides on the way out); ⌘L reveals regardless — focusAddress
    // never consults the zone.
    function revealZonePx() {
      const hb = context.hoverBar || {};
      return typeof hb.revealHeight === "number" ? hb.revealHeight : DEFAULT_REVEAL_PX;
    }

    let inStrip = false;
    document.addEventListener(
      "mousemove",
      (e) => {
        const zone = revealZonePx();
        const nearTop = zone > 0 && e.clientY <= zone;
        if (nearTop && !inStrip) {
          inStrip = true;
          scheduleReveal();
        } else if (!nearTop && inStrip) {
          inStrip = false;
          clearTimeout(revealTimer);
          revealTimer = null;
          if (visible && !cursorOverBar) scheduleHide();
        }
      },
      true
    );

    bar.addEventListener("mouseenter", () => {
      cursorOverBar = true;
      clearTimeout(hideTimer);
      hideTimer = null;
    });
    bar.addEventListener("mouseleave", () => {
      cursorOverBar = false;
      if (!inStrip) scheduleHide();
    });
    menu.addEventListener("mouseenter", () => {
      cursorOverBar = true;
      clearTimeout(hideTimer);
      hideTimer = null;
    });
    menu.addEventListener("mouseleave", () => {
      cursorOverBar = false;
      if (!inStrip) scheduleHide();
    });

    // -----------------------------------------------------------------------
    // URL display / address field.
    // -----------------------------------------------------------------------
    let lastRenderedHref = "";

    function renderUrl() {
      if (addrFocused()) return;
      const href = location.href;
      if (href === lastRenderedHref) return;
      lastRenderedHref = href;
      urlDisplay.innerHTML = "";
      let hostText = href;
      let pathText = "";
      try {
        const u = new URL(href);
        hostText = u.host || u.protocol;
        pathText = (u.pathname || "") + (u.search || "") + (u.hash || "");
        if (pathText === "/") pathText = "";
      } catch (_) {
        /* non-URL href — show raw */
      }
      const h = document.createElement("span");
      h.className = "host";
      h.textContent = hostText;
      urlDisplay.appendChild(h);
      if (pathText) {
        const p = document.createElement("span");
        p.className = "path";
        p.textContent = pathText;
        urlDisplay.appendChild(p);
      }
    }

    function focusAddress() {
      reveal();
      urlDisplay.classList.add("hidden");
      addr.classList.remove("hidden");
      addr.value = location.href;
      addr.focus();
      addr.select();
    }

    function blurAddress() {
      addr.classList.add("hidden");
      urlDisplay.classList.remove("hidden");
      closeOmni();
      lastRenderedHref = "";
      renderUrl();
      scheduleHide();
    }

    urlDisplay.addEventListener("click", focusAddress);
    urlDisplay.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        focusAddress();
      }
    });

    // -----------------------------------------------------------------------
    // OMNIBOX suggestions dropdown.
    // -----------------------------------------------------------------------
    let suggestions = []; // [{type:'history'|'search', url?, title, host?}]
    let selIndex = -1;
    let omniDebounce = null;
    let omniSeq = 0;

    function closeOmni() {
      omni.classList.remove("open");
      omni.innerHTML = "";
      suggestions = [];
      selIndex = -1;
    }

    function faviconUrl(hostName) {
      return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(hostName || "") + "&sz=32";
    }

    function renderOmni() {
      omni.innerHTML = "";
      if (!suggestions.length) {
        omni.classList.remove("open");
        return;
      }
      suggestions.forEach((s, i) => {
        const row = document.createElement("div");
        row.className = "orow" + (i === selIndex ? " sel" : "");
        row.setAttribute("role", "option");
        if (s.type === "search") {
          const t = document.createElement("span");
          t.className = "otitle";
          t.textContent = s.title;
          row.appendChild(icon("search"));
          row.appendChild(t);
        } else {
          const fav = document.createElement("img");
          fav.className = "fav";
          fav.src = faviconUrl(s.host);
          fav.addEventListener("error", () => {
            fav.style.visibility = "hidden";
          });
          const t = document.createElement("span");
          t.className = "otitle";
          t.textContent = s.title || s.host;
          const hst = document.createElement("span");
          hst.className = "ohost";
          hst.textContent = s.host;
          row.appendChild(fav);
          row.appendChild(t);
          row.appendChild(hst);
        }
        row.addEventListener("mouseenter", () => {
          selIndex = i;
          updateSelection();
        });
        row.addEventListener("mousedown", (e) => {
          // mousedown (not click) so we act before the input blurs.
          e.preventDefault();
          chooseSuggestion(i);
        });
        omni.appendChild(row);
      });
      omni.classList.add("open");
    }

    function updateSelection() {
      const rows = omni.querySelectorAll(".orow");
      rows.forEach((r, i) => r.classList.toggle("sel", i === selIndex));
    }

    function buildSearchRow(query) {
      const name = (context.searchEngine && context.searchEngine.name) || "Startpage";
      return { type: "search", title: `Search ${name} for “${query}”`, query };
    }

    async function queryOmni() {
      const q = addr.value.trim();
      if (!q) {
        closeOmni();
        return;
      }
      const seq = ++omniSeq;
      const resp = await send({ action: "omnibox", query: q });
      if (seq !== omniSeq) return; // a newer query superseded this one
      if (!addrFocused()) return;
      const hist = (resp && resp.suggestions) || [];
      suggestions = hist.map((h) => ({ type: "history", url: h.url, title: h.title, host: h.host }));
      suggestions.push(buildSearchRow(q));
      selIndex = -1;
      renderOmni();
    }

    function chooseSuggestion(i) {
      const s = suggestions[i];
      if (!s) return;
      closeOmni();
      addr.blur();
      blurAddress();
      if (s.type === "search") {
        send({ action: "navigate", input: s.query });
      } else {
        send({ action: "navigate", url: s.url, input: s.url });
      }
    }

    addr.addEventListener("input", () => {
      clearTimeout(omniDebounce);
      omniDebounce = setTimeout(queryOmni, OMNIBOX_DEBOUNCE_MS);
    });

    // Issue #19: while the address field or suggestions own the event, consume
    // it at this boundary so the page never observes it. Do not cancel default
    // — native editing, paste, arrows, and IME stay with the field.
    function containEditingKey(e) {
      e.stopPropagation();
    }
    for (const type of ["keydown", "keyup", "keypress"]) {
      addr.addEventListener(type, containEditingKey);
      omni.addEventListener(type, containEditingKey);
    }

    addr.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        if (suggestions.length) {
          e.preventDefault();
          selIndex = (selIndex + 1) % suggestions.length;
          updateSelection();
        }
      } else if (e.key === "ArrowUp") {
        if (suggestions.length) {
          e.preventDefault();
          selIndex = (selIndex - 1 + suggestions.length) % suggestions.length;
          updateSelection();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (selIndex >= 0 && suggestions[selIndex]) {
          chooseSuggestion(selIndex);
        } else {
          // No selection: current behavior — URL-ish navigate else search.
          const input = addr.value;
          closeOmni();
          addr.blur();
          blurAddress();
          send({ action: "navigate", input });
        }
      } else if (e.key === "Escape") {
        // Esc closes the dropdown FIRST, then (next Esc) blurs/restores.
        e.preventDefault();
        e.stopPropagation();
        if (omniOpen()) {
          closeOmni();
          return;
        }
        addr.value = location.href;
        addr.blur();
        blurAddress();
        clearTimeout(hideTimer);
        hideTimer = null;
        hide();
      }
    });
    addr.addEventListener("blur", () => {
      if (!addr.classList.contains("hidden")) blurAddress();
    });

    // -----------------------------------------------------------------------
    // Reload + copy-URL buttons.
    // -----------------------------------------------------------------------
    reloadBtn.addEventListener("click", () => {
      send({ action: "reload" });
    });

    let copyResetTimer = null;
    // Copy URL sits inside the address field, so a press must not read as a
    // click-away: suppressing the pointer default keeps the field's focus and
    // the user's half-typed text exactly where issue #19 put them.
    copyBtn.addEventListener("mousedown", (e) => e.preventDefault());
    copyBtn.addEventListener("click", async () => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(location.href);
        ok = true;
      } catch (_) {
        // Fallback: hidden textarea + execCommand.
        try {
          const ta = document.createElement("textarea");
          ta.value = location.href;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand("copy");
          document.body.removeChild(ta);
        } catch (_) {
          ok = false;
        }
      }
      if (ok) {
        // Feedback is the glyph alone: aria-label and title stay "Copy URL" so
        // the control never renames itself under an assistive-technology user.
        setIcon(copyBtn, "check");
        clearTimeout(copyResetTimer);
        copyResetTimer = setTimeout(() => setIcon(copyBtn, "link"), COPY_TICK_MS);
      }
    });

    // -----------------------------------------------------------------------
    // Promote + caret menu.
    // -----------------------------------------------------------------------
    function labelForPrimary() {
      return "Open in " + (context.primaryBrowserName || "Chrome");
    }
    function applyContextLabels() {
      promoteLabel.textContent = labelForPrimary();
    }

    function promote(dest, extra) {
      closeMenu();
      send(Object.assign({ action: "promote", dest }, extra || {}));
    }

    function closeMenu() {
      menu.classList.remove("open");
    }

    async function openMenu() {
      const ctxResp = await send({ action: "getContext" });
      if (ctxResp && ctxResp.context) {
        context = ctxResp.context;
        applyContextLabels();
        applyStyle();
      }
      const infoResp = await send({ action: "getLilInfo" });
      const isIncognito = infoResp && infoResp.incognito;
      if (infoResp && typeof infoResp.expiry !== "undefined") lilExpiry = infoResp.expiry;

      menu.innerHTML = "";
      const primaryName = context.primaryBrowserName || "Chrome";
      const hostName = context.browserName || "this browser";

      addItem(menu, "Open in " + primaryName, "⌘O", () => promote("primary"));

      if (context.browser && context.primaryBrowser && context.browser !== context.primaryBrowser) {
        addItem(menu, "Open in " + hostName + " tab", "", () => promote("host-tab"));
      }

      const groupsResp = await send({ action: "listGroups" });
      const groups = (groupsResp && groupsResp.groups) || [];
      if (groups.length) {
        addSep(menu);
        for (const g of groups) addGroupItem(menu, g, () => promote("group", { groupId: g.id }));
      }

      const known = Array.isArray(context.knownBrowsers) ? context.knownBrowsers : [];
      const others = known.filter(
        (b) => b && b.installed && b.slug && b.slug !== context.primaryBrowser && b.slug !== context.browser
      );
      if (others.length) {
        addSep(menu);
        for (const b of others) {
          addItem(menu, "Open in " + (b.name || b.slug), "", () => promote("browser", { browser: b.slug }));
        }
      }

      // ---- Keep (per-lil expiry override). ----
      addSep(menu);
      addSubLabel(menu, "Keep");
      const keepOpts = [
        ["Forever", "never"],
        ["6 hours", 6],
        ["12 hours", 12],
        ["24 hours", 24],
        ["Until quit", "quit"],
      ];
      for (const [label, val] of keepOpts) {
        addCheckItem(menu, label, expiryEquals(lilExpiry, val), () => {
          lilExpiry = val;
          closeMenu();
          send({ action: "setExpiry", expiry: val });
        });
      }

      addSep(menu);
      if (!isIncognito) {
        addItem(menu, "Let This Lil Nap", "", () => {
          closeMenu();
          send({ action: "sleepThisLil" });
        });
        addItem(menu, "Reopen in incognito lil", "", () => {
          closeMenu();
          send({ action: "reopenIncognito", url: location.href });
        });
      }

      addSep(menu);
      addItem(menu, "Settings…", "", () => {
        closeMenu();
        send({ action: "openSettings" });
      });
      addSep(menu);
      addItem(menu, "Close lil", "⌘W", () => {
        closeMenu();
        send({ action: "closeWindow" });
      });
      const manifest = chrome.runtime.getManifest();
      const versionText = (manifest && (manifest.version_name || manifest.version)) || "";
      if (versionText) {
        addSep(menu);
        addFooter(menu, versionText);
      }

      menu.classList.add("open");
    }

    function expiryEquals(a, b) {
      if (typeof a === "number" && typeof b === "number") return a === b;
      return String(a) === String(b);
    }

    function addItem(container, text, key, onClick) {
      const el = document.createElement("div");
      el.className = "item";
      el.setAttribute("role", "menuitem");
      const label = document.createElement("span");
      label.textContent = text;
      el.appendChild(label);
      if (key) {
        const k = document.createElement("span");
        k.className = "k";
        k.textContent = key;
        el.appendChild(k);
      }
      el.addEventListener("click", onClick);
      container.appendChild(el);
    }

    function addCheckItem(container, text, checked, onClick) {
      const el = document.createElement("div");
      el.className = "item" + (checked ? " checked" : "");
      el.setAttribute("role", "menuitemradio");
      el.setAttribute("aria-checked", checked ? "true" : "false");
      const label = document.createElement("span");
      label.textContent = text;
      el.appendChild(label);
      if (checked) el.appendChild(icon("check", "check"));
      el.addEventListener("click", onClick);
      container.appendChild(el);
    }

    function addSubLabel(container, text) {
      const el = document.createElement("div");
      el.className = "sub";
      el.textContent = text;
      container.appendChild(el);
    }

    function addGroupItem(container, group, onClick) {
      const el = document.createElement("div");
      el.className = "item";
      el.setAttribute("role", "menuitem");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = GROUP_COLORS[group.color] || GROUP_COLORS.grey;
      const name = document.createElement("span");
      name.className = "gname";
      name.textContent = group.title && group.title.trim() ? group.title : "Unnamed group";
      el.appendChild(dot);
      el.appendChild(name);
      el.addEventListener("click", onClick);
      container.appendChild(el);
    }

    function addSep(container) {
      const s = document.createElement("div");
      s.className = "sep";
      container.appendChild(s);
    }

    function addFooter(container, text) {
      const el = document.createElement("div");
      el.className = "foot";
      el.textContent = text;
      container.appendChild(el);
    }

    back.addEventListener("click", () => history.back());
    promoteBtn.addEventListener("click", () => promote("primary"));
    caretBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menuOpen()) closeMenu();
      else openMenu();
    });

    document.addEventListener(
      "click",
      (e) => {
        if (e.composedPath && e.composedPath().includes(host)) return;
        closeMenu();
      },
      true
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape") return;
        // The address field's own handler deals with Esc while focused.
        if (addrFocused()) return;
        if (omniOpen()) {
          closeOmni();
          return;
        }
        if (menuOpen()) {
          closeMenu();
          return;
        }
        hide();
      },
      true
    );

    window.addEventListener("popstate", renderUrl);
    window.addEventListener("hashchange", renderUrl);

    // -----------------------------------------------------------------------
    // clickHint (unchanged).
    // -----------------------------------------------------------------------
    document.addEventListener(
      "click",
      (e) => {
        const path = e.composedPath ? e.composedPath() : [];
        let anchor = null;
        for (const node of path) {
          if (node && node.tagName === "A" && node.href) {
            anchor = node;
            break;
          }
        }
        if (!anchor) return;
        fire({ action: "clickHint", url: anchor.href, meta: e.metaKey, ts: Date.now() });
      },
      true
    );

    // -----------------------------------------------------------------------
    // Keyboard shortcuts (⌘L reveal+focus, ⌘O promote).
    // -----------------------------------------------------------------------
    window.addEventListener(
      "keydown",
      (e) => {
        if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey) return;
        if (e.key === "l" || e.key === "L") {
          e.preventDefault();
          e.stopPropagation();
          focusAddress();
        } else if (e.key === "o" || e.key === "O") {
          e.preventDefault();
          e.stopPropagation();
          promote("primary");
        }
      },
      true
    );

    // React to scheme changes for solid/glass adaptive tones.
    if (window.matchMedia) {
      try {
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyStyle);
      } catch (_) {
        /* older browsers */
      }
    }

    // Hot-apply (issue #12): the worker pushes its freshly replaced context to
    // every live lil. Swap it in and re-derive everything the overlay shows:
    // style/tint, the promote label, and the reveal zone (read live by the
    // mousemove handler above).
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || msg.action !== "contextUpdate" || !msg.context) return;
        context = msg.context;
        applyContextLabels();
        applyStyle();
      });
    } catch (_) {
      /* context invalidated */
    }

    // Initial context fetch.
    send({ action: "getContext" }).then((resp) => {
      if (resp && resp.context) context = resp.context;
      applyContextLabels();
      applyStyle();
    });
    applyContextLabels();
    applyStyle();
    renderUrl();
  }

  init();
})();
