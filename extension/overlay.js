// lil-chromium overlay content script (v0.3).
//
// Runs on every http/https page. Asks the SW whether this tab lives in a lil
// (ephemeral popup window); if not, it does almost nothing (normal browsing must
// stay untouched, aside from silent form-dirty tracking which the sleep sweep
// needs — reported only for lils via the SW's per-tab flag). If it is a lil, it
// mounts a HOVER-REVEAL top bar in a closed shadow DOM with: back, editable
// address field with an omnibox suggestions dropdown, reload, copy-URL,
// "Open in {defaultBrowser}" promote, and a caret menu (promote targets, host
// groups, other browsers, Keep/expiry, Sleep, Reopen incognito, Close).

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

  const REVEAL_DELAY_MS = 80;
  const HIDE_DELAY_MS = 300;
  const SLIDE_MS = 160;
  const HOVER_STRIP_PX = 24;
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
      defaultBrowser: "chrome",
      defaultBrowserName: "Chrome",
      fallbackBrowser: "chrome",
      linkBehavior: "new-lil",
      ephemeralDefault: "never",
      sleep: { whitelist: [] },
      searchEngine: { name: "Google", template: "https://www.google.com/search?q=%s" },
      hoverBar: { style: "glass", tint: null },
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
        .btn.icon { width: 30px; padding: 0; font-size: 16px; flex: 0 0 auto; }
        .btn .label { font-weight: 550; letter-spacing: 0.1px; }
        .kbd { font-size: 11px; opacity: 0.55; font-variant-numeric: tabular-nums; }
        .caret { font-size: 11px; }

        /* Address field container (positions the omnibox dropdown). */
        .addrwrap { position: relative; flex: 1 1 auto; min-width: 0; height: 30px; }

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
          padding: 0 12px;
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
          padding: 0 12px;
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
        .orow .search-ico { font-size: 14px; width: 16px; text-align: center; flex: 0 0 auto; }

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
        .item.checked .check { margin-left: auto; opacity: 0.9; }
        .item .k { margin-left: auto; font-size: 11px; opacity: 0.5; font-variant-numeric: tabular-nums; }
        .sub { padding: 5px 10px 2px; font-size: 11px; opacity: 0.5; text-transform: uppercase; letter-spacing: 0.4px; }
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
          <button class="btn icon back" title="Back" aria-label="Back">‹</button>
          <div class="addrwrap">
            <div class="url" role="button" tabindex="0" title="Click to edit"></div>
            <input class="addr hidden" type="text" spellcheck="false" autocomplete="off"
                   aria-label="Address" placeholder="Search or enter address" />
            <div class="omni" role="listbox"></div>
          </div>
          <button class="btn icon reload" title="Reload" aria-label="Reload">⟳</button>
          <button class="btn icon copy" title="Copy URL" aria-label="Copy URL">⧉</button>
          <button class="btn promote">
            <span class="label">Open in Chrome</span>
            <span class="kbd">⌘O</span>
          </button>
          <button class="btn icon caretbtn" aria-label="More options"><span class="caret">▾</span></button>
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

    let inStrip = false;
    document.addEventListener(
      "mousemove",
      (e) => {
        const nearTop = e.clientY <= HOVER_STRIP_PX;
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
          const ico = document.createElement("span");
          ico.className = "search-ico";
          ico.textContent = "⌕";
          const t = document.createElement("span");
          t.className = "otitle";
          t.textContent = s.title;
          row.appendChild(ico);
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
      const name = (context.searchEngine && context.searchEngine.name) || "Google";
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
        copyBtn.textContent = "✓";
        setTimeout(() => {
          copyBtn.textContent = "⧉";
        }, COPY_TICK_MS);
      }
    });

    // -----------------------------------------------------------------------
    // Promote + caret menu.
    // -----------------------------------------------------------------------
    function labelForDefault() {
      return "Open in " + (context.defaultBrowserName || "Chrome");
    }
    function applyContextLabels() {
      promoteLabel.textContent = labelForDefault();
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
      const defName = context.defaultBrowserName || "Chrome";
      const hostName = context.browserName || "this browser";

      addItem(menu, "Open in " + defName, "⌘O", () => promote("default"));

      if (context.browser && context.defaultBrowser && context.browser !== context.defaultBrowser) {
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
        (b) => b && b.installed && b.slug && b.slug !== context.defaultBrowser && b.slug !== context.browser
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

      // ---- Sleep + incognito. ----
      addSep(menu);
      if (!isIncognito) {
        addItem(menu, "Sleep this lil", "", () => {
          closeMenu();
          send({ action: "sleepThisLil" });
        });
        addItem(menu, "Reopen in incognito lil", "", () => {
          closeMenu();
          send({ action: "reopenIncognito", url: location.href });
        });
      }

      addSep(menu);
      addItem(menu, "Close lil", "⌘W", () => {
        closeMenu();
        send({ action: "closeWindow" });
      });

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
      const check = document.createElement("span");
      check.className = "check k";
      check.textContent = checked ? "✓" : "";
      el.appendChild(check);
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

    back.addEventListener("click", () => history.back());
    promoteBtn.addEventListener("click", () => promote("default"));
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
          promote("default");
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
