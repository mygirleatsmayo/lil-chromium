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
// with a fallback here, only if the worker fails or is unreachable, that clears
// nap state and navigates directly).
// See PROTOCOL.md Lil Nap.

(() => {
  const IDB_NAME = "lil-sleep";
  const IDB_STORE = "captures";
  // Registry key and nap-only field names mirror background.js — the
  // extension ships unpacked with no shared module between page and worker.
  const REGISTRY_KEY = "ephemeralWindows";

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

  function idbDelete(key) {
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(IDB_NAME, 1);
      } catch (e) {
        reject(e);
        return;
      }
      req.onsuccess = () => {
        const db = req.result;
        let tx;
        try {
          tx = db.transaction(IDB_STORE, "readwrite");
        } catch (e) {
          db.close();
          reject(e);
          return;
        }
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
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
  // PROTOCOL.md Lil Nap). The direct fallback below fires only on an explicit
  // worker failure or genuine unreachability — never in parallel with the
  // worker's bounded path. ----
  let waking = false;

  // Leaving the nap document directly must finish what the worker could not:
  // clear this lil's nap-only registry fields (the lil stays registered) and
  // delete the capture, then navigate. Best effort throughout — a dead
  // extension context must not stop the page from waking itself.
  async function reconcileNapState() {
    try {
      const obj = await chrome.storage.local.get(REGISTRY_KEY);
      const reg = (obj && obj[REGISTRY_KEY]) || {};
      let touched = false;
      for (const entry of Object.values(reg)) {
        if (captureKey && entry && entry.sleepCaptureKey === captureKey) {
          delete entry.slept;
          delete entry.sleepCaptureKey;
          delete entry.originalUrl;
          delete entry.originalTitle;
          entry.url = originalUrl;
          entry.lastInteraction = Date.now();
          touched = true;
        }
      }
      if (touched) await chrome.storage.local.set({ [REGISTRY_KEY]: reg });
    } catch (_) {
      /* storage unreachable — navigate anyway */
    }
    if (captureKey) {
      try {
        await idbDelete(captureKey);
      } catch (_) {
        /* the worker's sweep keeps orphan-capture cleanup as a backstop */
      }
    }
  }

  function leaveNap() {
    if (!originalUrl) return;
    (async () => {
      await reconcileNapState();
      try {
        location.replace(originalUrl);
      } catch (_) {
        /* ignore */
      }
    })();
  }

  function wake() {
    if (waking) return;
    waking = true;
    let answered = false; // the worker answered, one way or another
    try {
      chrome.runtime.sendMessage({ action: "wakeLil" }, (reply) => {
        answered = true;
        // Only a successful reply means the worker owns the transition: an
        // explicit failure or a message error leaves the nap page to go
        // directly.
        if (chrome.runtime.lastError || !reply || !reply.ok) leaveNap();
      });
    } catch (_) {
      leaveNap(); // context invalidated — no worker will answer
      return;
    }
    // A reply that never arrives well past the worker's 500 ms cap (plus
    // reply margin) means the worker is unreachable: go directly rather than
    // strand. The deadline can never race the bounded path — a successful
    // swap has removed this page long before it fires.
    setTimeout(() => {
      if (!answered) leaveNap();
    }, 1000);
  }

  document.addEventListener("click", wake, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Escape") wake();
  });
})();
