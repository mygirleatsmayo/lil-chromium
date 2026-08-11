// lil-chromium sleep page.
// Mascot ships as a data URI (text-only deploy pipeline); see assets/sleeping-lil-data.js.
if (typeof window !== "undefined" && window.SLEEPING_LIL_DATA) {
  document.addEventListener("DOMContentLoaded", () => {
    const m = document.getElementById("mascot");
    if (m && !m.src) m.src = window.SLEEPING_LIL_DATA;
  });
}
//
// Runs in the extension's own origin (chrome-extension://) so it shares the SW's
// IndexedDB. Reads the capture key + original URL + tint from the query string,
// paints the screenshot full-bleed under a tinted overlay, and wakes the lil on
// any click (SW navigates the tab back to the original URL and deletes the
// capture). See PROTOCOL.md §Sleep.

(() => {
  const IDB_NAME = "lil-sleep";
  const IDB_STORE = "captures";

  const params = new URLSearchParams(location.search);
  const captureKey = params.get("k") || "";
  const originalUrl = params.get("u") || "";
  const tintParam = params.get("tint") || "purple";

  const shot = document.getElementById("shot");
  const tintEl = document.getElementById("tint");

  // ---- Tint resolution: "purple" | "gray"/"grey" | #rrggbb → rgba @ 0.55. ----
  const NAMED = {
    purple: [88, 60, 140],
    gray: [60, 60, 67],
    grey: [60, 60, 67],
  };

  function hexToRgb(hex) {
    let h = hex.replace(/^#/, "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function resolveTint(v) {
    const key = (v || "").trim().toLowerCase();
    if (NAMED[key]) return NAMED[key];
    if (key.startsWith("#")) {
      const rgb = hexToRgb(key);
      if (rgb) return rgb;
    }
    return NAMED.purple;
  }

  const [r, g, b] = resolveTint(tintParam);
  tintEl.style.background = `rgba(${r}, ${g}, ${b}, 0.55)`;

  // ---- Load the screenshot Blob from IndexedDB and paint it. ----
  function idbGet(key) {
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(IDB_NAME, 1);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        let tx;
        try {
          tx = db.transaction(IDB_STORE, "readonly");
        } catch (e) {
          db.close();
          reject(e);
          return;
        }
        const getReq = tx.objectStore(IDB_STORE).get(key);
        getReq.onsuccess = () => {
          db.close();
          resolve(getReq.result || null);
        };
        getReq.onerror = () => {
          db.close();
          reject(getReq.error);
        };
      };
      req.onerror = () => reject(req.error);
    });
  }

  let objectUrl = null;
  (async () => {
    if (!captureKey) return;
    try {
      const blob = await idbGet(captureKey);
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        shot.src = objectUrl;
      }
    } catch (_) {
      /* no capture — the tinted badge still shows */
    }
  })();

  window.addEventListener("beforeunload", () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });

  // ---- Wake on any click. Ask the SW to restore, with a hard fallback so the
  // page never stays stuck if the SW is unreachable. ----
  let waking = false;
  function wake() {
    if (waking) return;
    waking = true;
    let handled = false;
    try {
      chrome.runtime.sendMessage({ action: "wakeLil" }, () => {
        void chrome.runtime.lastError;
        handled = true;
      });
    } catch (_) {
      /* context invalidated — fall through to fallback */
    }
    // Fallback: if the SW doesn't navigate us within 500ms, go directly.
    setTimeout(() => {
      if (!handled && originalUrl) {
        try {
          location.replace(originalUrl);
        } catch (_) {
          /* ignore */
        }
      }
    }, 500);
  }

  document.addEventListener("click", wake, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Escape") wake();
  });
})();
