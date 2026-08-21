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
// IndexedDB. Reads the capture key + original URL + original title + tint from
// the query string, paints the screenshot full-bleed under a tinted overlay,
// titles the document with the sleeping symbol, and wakes the lil on any click
// (the SW runs the bounded wake transition — the original URL loads behind this
// static image, the swap lands within 180–500 ms, and the capture is deleted —
// with a hard fallback here if the worker fails or is unreachable).
// See PROTOCOL.md Lil Nap.

(() => {
  const IDB_NAME = "lil-sleep";
  const IDB_STORE = "captures";

  const params = new URLSearchParams(location.search);
  const captureKey = params.get("k") || "";
  const originalUrl = params.get("u") || "";
  const originalTitle = params.get("t") || "";
  const tintParam = params.get("tint") || "purple";

  document.title = "💤 " + originalTitle;

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

  // ---- Wake on any click. The worker owns the bounded transition (see
  // PROTOCOL.md Lil Nap); a hard fallback keeps the page from stranding when
  // the worker fails or is unreachable. ----
  let waking = false;
  function wake() {
    if (waking) return;
    waking = true;
    let owned = false; // the worker confirmed it owns the wake transition
    try {
      chrome.runtime.sendMessage({ action: "wakeLil" }, (reply) => {
        // Only a successful reply suppresses the fallback: a failed or
        // unreachable worker must not leave the nap page stuck.
        owned = !chrome.runtime.lastError && !!(reply && reply.ok);
      });
    } catch (_) {
      /* context invalidated — the fallback below still fires */
    }
    // Fallback: if the worker hasn't owned the wake within 500ms, go directly.
    setTimeout(() => {
      if (!owned && originalUrl) {
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
