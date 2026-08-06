// lil-chromium overlay content script.
//
// Runs on every http/https page. Asks the SW whether this tab lives in an
// ephemeral little window; if not, it does absolutely nothing (normal Chrome
// browsing must stay untouched). If it does, it mounts a compact "Open in
// Chrome" pill in a closed shadow DOM and wires ⌘O to promote the tab.

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

  async function init() {
    const resp = await send({ action: "isEphemeral" });
    if (!resp || !resp.ephemeral) return; // normal window: stay invisible
    mountUI();
  }

  function mountUI() {
    // Host div on documentElement (survives <body> replacement). Closed shadow
    // root so page scripts/styles can't see or touch our UI.
    const host = document.createElement("div");
    host.style.cssText =
      "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";
    (document.documentElement || document.body).appendChild(host);
    const root = host.attachShadow({ mode: "closed" });

    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .wrap {
          position: fixed;
          top: 12px;
          right: 12px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          opacity: 0;
          transition: opacity 220ms ease;
        }
        .wrap.show { opacity: 1; }
        .pill {
          display: inline-flex;
          align-items: stretch;
          height: 30px;
          border-radius: 15px;
          background: rgba(28, 28, 30, 0.72);
          -webkit-backdrop-filter: blur(14px) saturate(160%);
          backdrop-filter: blur(14px) saturate(160%);
          color: #fff;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28), 0 0 0 0.5px rgba(255, 255, 255, 0.12) inset;
          overflow: hidden;
          user-select: none;
          font-size: 12.5px;
          line-height: 1;
        }
        .main {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 0 11px 0 13px;
          cursor: pointer;
          transition: background 120ms ease;
          white-space: nowrap;
        }
        .main:hover { background: rgba(255, 255, 255, 0.12); }
        .label { font-weight: 550; letter-spacing: 0.1px; }
        .hint {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.62);
          font-variant-numeric: tabular-nums;
        }
        .caret {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          cursor: pointer;
          border-left: 0.5px solid rgba(255, 255, 255, 0.16);
          transition: background 120ms ease;
          font-size: 10px;
          color: rgba(255, 255, 255, 0.8);
        }
        .caret:hover { background: rgba(255, 255, 255, 0.12); }
        .menu {
          position: absolute;
          top: 36px;
          right: 0;
          min-width: 220px;
          background: rgba(32, 32, 34, 0.92);
          -webkit-backdrop-filter: blur(18px) saturate(160%);
          backdrop-filter: blur(18px) saturate(160%);
          border-radius: 11px;
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4), 0 0 0 0.5px rgba(255, 255, 255, 0.12) inset;
          padding: 5px;
          display: none;
          color: #fff;
          font-size: 12.5px;
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
        .item:hover { background: rgba(255, 255, 255, 0.13); }
        .item .k {
          margin-left: auto;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.55);
          font-variant-numeric: tabular-nums;
        }
        .sep {
          height: 0.5px;
          background: rgba(255, 255, 255, 0.14);
          margin: 5px 6px;
        }
        .dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          flex: 0 0 auto;
        }
        .gname { overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
        .muted { color: rgba(255, 255, 255, 0.5); font-size: 11px; padding: 6px 10px; }
      </style>
      <div class="wrap" part="wrap">
        <div class="pill">
          <div class="main" role="button" tabindex="0">
            <span class="label">Open in Chrome</span>
            <span class="hint">⌘O</span>
          </div>
          <div class="caret" role="button" tabindex="0" aria-label="More options">▾</div>
        </div>
        <div class="menu" role="menu"></div>
      </div>
    `;

    const wrap = root.querySelector(".wrap");
    const main = root.querySelector(".main");
    const caret = root.querySelector(".caret");
    const menu = root.querySelector(".menu");

    // Fade in after 300ms so it doesn't flash during load.
    setTimeout(() => wrap.classList.add("show"), 300);

    function promote(dest, groupId) {
      closeMenu();
      send({ action: "promote", dest, groupId });
    }

    function closeMenu() {
      menu.classList.remove("open");
    }

    async function openMenu() {
      // Rebuild each open so group list stays fresh.
      menu.innerHTML = "";
      addItem(menu, "New tab in Chrome", "⌘O", () => promote("tab"));
      addItem(menu, "New Chrome window", "", () => promote("window"));

      const resp = await send({ action: "listGroups" });
      const groups = (resp && resp.groups) || [];
      if (groups.length) {
        addSep(menu);
        for (const g of groups) {
          addGroupItem(menu, g, () => promote("group", g.id));
        }
      }
      addSep(menu);
      addItem(menu, "Close window", "⌘W", () => {
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

    main.addEventListener("click", () => promote("tab"));
    main.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        promote("tab");
      }
    });
    caret.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu.classList.contains("open")) closeMenu();
      else openMenu();
    });

    // Close on outside click / Esc.
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
        if (e.key === "Escape") closeMenu();
      },
      true
    );

    // Primary shortcut: ⌘O (no shift/alt). Capture phase + preventDefault so the
    // page/Chrome can't steal it. ⌘W is native — we deliberately don't touch it.
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && (e.key === "o" || e.key === "O")) {
          e.preventDefault();
          e.stopPropagation();
          promote("tab");
        }
      },
      true
    );
  }

  init();
})();
