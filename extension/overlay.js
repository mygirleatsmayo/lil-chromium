// lil-chromium overlay content script.
//
// Runs on every http/https page. Asks the SW whether this tab lives in a lil
// (ephemeral popup window); if not, it does absolutely nothing (normal browsing
// must stay untouched). If it does, it mounts a HOVER-REVEAL top bar in a closed
// shadow DOM: invisible by default so it never covers page UI, sliding down when
// the cursor rests near the top edge (or on ⌘L). The bar carries a back button,
// an editable address field, an "Open in {defaultBrowser}" promote button, and a
// caret menu (promote targets, host tab groups, other browsers, close lil).

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

  // Hover-intent timing constants (see the reveal/hide logic below).
  const REVEAL_DELAY_MS = 80; // cursor must dwell in the top strip this long
  const HIDE_DELAY_MS = 300; // hide this long after the cursor leaves the bar
  const SLIDE_MS = 160; // slide animation duration (mirrored in CSS)
  const HOVER_STRIP_PX = 24; // invisible top strip that arms the reveal
  const POLL_MS = 500; // URL re-check cadence while the bar is visible

  // Wrapper so extension-context invalidation (reloads/updates) never throws
  // into the page. Resolves null on any failure.
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

  // Fire-and-forget variant for hot-path messages (clickHint) — no await, and
  // never throws into the page.
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
    mountUI();
  }

  function mountUI() {
    // Context (browser identity + config). Fetched at mount; defaults keep the
    // UI usable if the handshake hasn't landed yet. Refreshed lazily on menu open.
    let context = {
      browser: "chrome",
      browserName: "Chrome",
      defaultBrowser: "chrome",
      defaultBrowserName: "Chrome",
      fallbackBrowser: "chrome",
      linkBehavior: "same-lil",
      knownBrowsers: [],
    };

    // Host div on documentElement (survives <body> replacement). Closed shadow
    // root so page scripts/styles can't see or touch our UI.
    const host = document.createElement("div");
    host.style.cssText =
      "all: initial; position: fixed; top: 0; left: 0; width: 100%; height: 0; z-index: 2147483647; pointer-events: none;";
    (document.documentElement || document.body).appendChild(host);
    const root = host.attachShadow({ mode: "closed" });

    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; margin: 0; padding: 0; }

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
          /* Glassy look. Light defaults; dark via prefers-color-scheme below. */
          background: rgba(255, 255, 255, 0.72);
          -webkit-backdrop-filter: blur(20px) saturate(1.4);
          backdrop-filter: blur(20px) saturate(1.4);
          border-bottom: 0.5px solid rgba(0, 0, 0, 0.14);
          color: #1c1c1e;
          /* Hidden = slid up out of view + transparent. */
          transform: translateY(-100%);
          opacity: 0;
          transition: transform ${SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${SLIDE_MS}ms ease;
        }
        .bar.show {
          transform: translateY(0);
          opacity: 1;
        }

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
        .btn:hover { background: rgba(0, 0, 0, 0.08); }
        .btn.icon { width: 30px; padding: 0; font-size: 16px; flex: 0 0 auto; }
        .btn .label { font-weight: 550; letter-spacing: 0.1px; }
        .kbd {
          font-size: 11px;
          opacity: 0.55;
          font-variant-numeric: tabular-nums;
        }
        .caret { font-size: 11px; }

        /* Address field — flex-1, centered text. Borderless; a subtle capsule. */
        .addr {
          flex: 1 1 auto;
          min-width: 0;
          height: 30px;
          border: none;
          outline: none;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.06);
          color: inherit;
          font: inherit;
          text-align: center;
          padding: 0 12px;
          transition: background 120ms ease;
        }
        .addr:focus { background: rgba(0, 0, 0, 0.1); text-align: left; }
        .addr::placeholder { color: rgba(0, 0, 0, 0.4); }

        /* Compact idle URL display, shown in place of the input when unfocused. */
        .url {
          flex: 1 1 auto;
          min-width: 0;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.06);
          padding: 0 12px;
          cursor: text;
          overflow: hidden;
          white-space: nowrap;
        }
        .url .host { font-weight: 600; }
        .url .path { opacity: 0.5; overflow: hidden; text-overflow: ellipsis; }

        .hidden { display: none !important; }

        /* Caret menu, anchored under the promote button. */
        .menu {
          position: fixed;
          top: 46px;
          right: 10px;
          min-width: 240px;
          max-width: 340px;
          background: rgba(250, 250, 250, 0.96);
          -webkit-backdrop-filter: blur(20px) saturate(1.4);
          backdrop-filter: blur(20px) saturate(1.4);
          border-radius: 11px;
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22), 0 0 0 0.5px rgba(0, 0, 0, 0.1);
          padding: 5px;
          display: none;
          color: #1c1c1e;
          pointer-events: auto;
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
        .item:hover { background: rgba(0, 0, 0, 0.09); }
        .item .k {
          margin-left: auto;
          font-size: 11px;
          opacity: 0.5;
          font-variant-numeric: tabular-nums;
        }
        .sep { height: 0.5px; background: rgba(0, 0, 0, 0.12); margin: 5px 6px; }
        .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
        .gname { overflow: hidden; text-overflow: ellipsis; max-width: 190px; }

        @media (prefers-color-scheme: dark) {
          .bar {
            background: rgba(30, 30, 32, 0.72);
            border-bottom: 0.5px solid rgba(255, 255, 255, 0.14);
            color: #f2f2f7;
          }
          .btn:hover { background: rgba(255, 255, 255, 0.12); }
          .addr { background: rgba(255, 255, 255, 0.1); }
          .addr:focus { background: rgba(255, 255, 255, 0.16); }
          .addr::placeholder { color: rgba(255, 255, 255, 0.45); }
          .url { background: rgba(255, 255, 255, 0.1); }
          .menu {
            background: rgba(40, 40, 42, 0.96);
            box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5), 0 0 0 0.5px rgba(255, 255, 255, 0.12);
            color: #f2f2f7;
          }
          .item:hover { background: rgba(255, 255, 255, 0.14); }
          .sep { background: rgba(255, 255, 255, 0.16); }
        }
      </style>
      <div class="bar" part="bar">
        <button class="btn icon back" title="Back" aria-label="Back">‹</button>
        <div class="url" role="button" tabindex="0" title="Click to edit"></div>
        <input class="addr hidden" type="text" spellcheck="false" autocomplete="off"
               aria-label="Address" placeholder="Search or enter address" />
        <button class="btn promote">
          <span class="label">Open in Chrome</span>
          <span class="kbd">⌘O</span>
        </button>
        <button class="btn icon caretbtn" aria-label="More options"><span class="caret">▾</span></button>
      </div>
      <div class="menu" role="menu"></div>
    `;

    const bar = root.querySelector(".bar");
    const back = root.querySelector(".back");
    const urlDisplay = root.querySelector(".url");
    const addr = root.querySelector(".addr");
    const promoteBtn = root.querySelector(".promote");
    const promoteLabel = promoteBtn.querySelector(".label");
    const caretBtn = root.querySelector(".caretbtn");
    const menu = root.querySelector(".menu");

    // -----------------------------------------------------------------------
    // Reveal / hide state machine.
    //
    // The bar is invisible by default. Dwelling in the top strip for
    // REVEAL_DELAY_MS reveals it; leaving the bar+strip region hides it after
    // HIDE_DELAY_MS UNLESS the address field is focused or the menu is open
    // (those pin it open). Esc hides. A lightweight URL poll runs only while
    // the bar is visible.
    // -----------------------------------------------------------------------
    let revealTimer = null;
    let hideTimer = null;
    let pollTimer = null;
    let visible = false;
    let cursorOverBar = false; // over the bar or its open menu

    function menuOpen() {
      return menu.classList.contains("open");
    }
    function addrFocused() {
      return root.activeElement === addr;
    }
    // The bar must stay up while the user is typing an address, reading the
    // menu, or hovering it. Any of these blocks the hide countdown.
    function pinned() {
      return addrFocused() || menuOpen() || cursorOverBar;
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
      if (pinned()) return; // never hide while pinned
      clearTimeout(revealTimer);
      revealTimer = null;
      if (!visible) return;
      visible = false;
      bar.classList.remove("show");
      closeMenu();
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

    // Reveal intent via a page-level mousemove (rather than an overlay hit-strip)
    // so we never intercept clicks on the page's own top 24px. When the cursor
    // is within HOVER_STRIP_PX of the top, arm the reveal; when it drops below
    // that (and isn't over the bar), start the hide countdown.
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

    // Once visible, keep it up while the cursor is over the bar; start the hide
    // countdown when it leaves. Entering cancels a pending hide.
    bar.addEventListener("mouseenter", () => {
      cursorOverBar = true;
      clearTimeout(hideTimer);
      hideTimer = null;
    });
    bar.addEventListener("mouseleave", () => {
      cursorOverBar = false;
      if (!inStrip) scheduleHide();
    });
    // Keep the menu region "part of the bar" for hover purposes.
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
      if (addrFocused()) return; // don't clobber what the user is typing
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

    // Restore the compact display and drop focus. If restoreUrl, also reset the
    // field value (used by first-Esc, which should not navigate).
    function blurAddress() {
      addr.classList.add("hidden");
      urlDisplay.classList.remove("hidden");
      lastRenderedHref = ""; // force re-render
      renderUrl();
      // Blur can trigger a hide if nothing else pins the bar.
      scheduleHide();
    }

    urlDisplay.addEventListener("click", focusAddress);
    urlDisplay.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        focusAddress();
      }
    });

    addr.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const input = addr.value;
        addr.blur();
        blurAddress();
        send({ action: "navigate", input });
      } else if (e.key === "Escape") {
        // First Esc while focused: blur + restore URL (handled here so the
        // page/global Esc handler doesn't also hide the bar in one press).
        e.preventDefault();
        e.stopPropagation();
        addr.value = location.href;
        addr.blur();
        blurAddress();
      }
    });
    addr.addEventListener("blur", () => {
      // If focus left the field for any reason, return to compact display.
      if (!addr.classList.contains("hidden")) blurAddress();
    });

    // -----------------------------------------------------------------------
    // Promote + menu.
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
      // Re-fetch context lazily so browser/group lists reflect current config.
      const ctxResp = await send({ action: "getContext" });
      if (ctxResp && ctxResp.context) {
        context = ctxResp.context;
        applyContextLabels();
      }

      menu.innerHTML = "";
      const defName = context.defaultBrowserName || "Chrome";
      const hostName = context.browserName || "this browser";

      // Promote to the configured default browser (⌘O action).
      addItem(menu, "Open in " + defName, "⌘O", () => promote("default"));

      // If this browser isn't the default, offer a no-reload move into a host tab.
      if (context.browser && context.defaultBrowser && context.browser !== context.defaultBrowser) {
        addItem(menu, "Open in " + hostName + " tab", "", () => promote("host-tab"));
      }

      // Host browser's tab groups (no-reload move into a group).
      const groupsResp = await send({ action: "listGroups" });
      const groups = (groupsResp && groupsResp.groups) || [];
      if (groups.length) {
        addSep(menu);
        for (const g of groups) {
          addGroupItem(menu, g, () => promote("group", { groupId: g.id }));
        }
      }

      // Other installed browsers (open-external hand-off). Skip the default and
      // the host browser — those already have dedicated items above.
      const known = Array.isArray(context.knownBrowsers) ? context.knownBrowsers : [];
      const others = known.filter(
        (b) =>
          b &&
          b.installed &&
          b.slug &&
          b.slug !== context.defaultBrowser &&
          b.slug !== context.browser
      );
      if (others.length) {
        addSep(menu);
        for (const b of others) {
          addItem(menu, "Open in " + (b.name || b.slug), "", () =>
            promote("browser", { browser: b.slug })
          );
        }
      }

      addSep(menu);
      addItem(menu, "Close lil", "⌘W", () => {
        closeMenu();
        send({ action: "closeWindow" });
      });

      menu.classList.add("open");
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

    // Close the menu on outside click / hide on Esc.
    document.addEventListener(
      "click",
      (e) => {
        // Clicks inside our closed shadow root report the host as composedPath[0]
        // from the page's perspective; anything landing on `host` is ours.
        if (e.composedPath && e.composedPath().includes(host)) return;
        closeMenu();
      },
      true
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape") return;
        // If the address field is focused, its own handler already dealt with
        // this Esc (blur + restore) and stopped propagation, so we won't see it.
        if (menuOpen()) {
          closeMenu();
          return;
        }
        hide();
      },
      true
    );

    // -----------------------------------------------------------------------
    // URL freshness: react to in-page navigation. The interval poll (only while
    // visible) is the backstop; these fire immediately.
    // -----------------------------------------------------------------------
    window.addEventListener("popstate", renderUrl);
    window.addEventListener("hashchange", renderUrl);

    // -----------------------------------------------------------------------
    // clickHint — capture anchor clicks and relay ⌘ state to the SW so it can
    // decide same-lil vs new-lil. We do NOT preventDefault: the browser does
    // its native thing and the SW reconciles via onCreatedNavigationTarget.
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
    // Keyboard shortcuts (capture phase).
    //   ⌘L: reveal bar + focus address field + select all.
    //   ⌘O: promote to the default browser.
    // We intercept nothing else.
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

    // Initial context fetch — label the button once the handshake result lands.
    send({ action: "getContext" }).then((resp) => {
      if (resp && resp.context) context = resp.context;
      applyContextLabels();
    });
    applyContextLabels();
    renderUrl();
  }

  init();
})();
