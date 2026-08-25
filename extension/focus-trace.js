// LILFOCUS — behavior-neutral diagnostic seam for issue #30's real-Mac focus loop.
//
// The two v0.4 focus regressions (a closing lil restores the wrong Helium
// sibling; an opening lil raises an unrelated sibling) can only be told apart
// with the extension's own view: which windows existed, which one Chromium
// considered focused, which predecessor was chosen, and what was asked to take
// focus on close. None of that is observable from outside the browser, so this
// module streams it to a local collector that `scripts/focus-loop.mjs` runs.
//
// Discipline, so this can stay in the tree without becoming product behavior:
//   - Inert until armed. Arming arrives over the relay socket (the host already
//     forwards unknown socket lines to the extension verbatim), never from a
//     page, and never from storage — a worker restart disarms it.
//   - Every arm carries a TTL, so a forgotten run stops tracing on its own.
//   - No awaits on the traced code path and every failure swallowed, so an
//     armed worker behaves exactly like a disarmed one.
//
// Cleanup check: `node scripts/focus-loop.mjs cleanup`.

const FOCUS_TRACE_TAG = "LILFOCUS";
const FOCUS_TRACE_TYPE = "lil-focus-trace"; // control message type over the relay
const FOCUS_TRACE_MAX_TTL_MS = 30 * 60 * 1000;
const FOCUS_TRACE_DEFAULT_TTL_MS = 15 * 60 * 1000;

// null while disarmed. { runId, endpoint, expiresAt, seq }
let focusTraceRun = null;
// Serializes posts so the collector receives events in emission order.
let focusTraceTail = Promise.resolve();
// Injected by the worker so a snapshot can tell lils from ordinary windows.
let focusTraceIsLil = async () => false;

/** Let the worker supply its own lil predicate without exporting internals. */
function focusTraceInit(hooks) {
  if (hooks && typeof hooks.isLil === "function") focusTraceIsLil = hooks.isLil;
}

function focusTraceActive() {
  if (!focusTraceRun) return false;
  if (Date.now() >= focusTraceRun.expiresAt) {
    focusTraceRun = null;
    return false;
  }
  return true;
}

/**
 * Consume a `lil-focus-trace` control message. Returns true when the message
 * belonged to this seam, so the worker can keep treating everything else as
 * unknown.
 *
 * Arm:      {type, runId, endpoint, ttlMs?}
 * Disarm:   {type, enabled: false}
 * Snapshot: {type, snapshot: "<label>"} — emit one window reading on demand.
 */
function focusTraceControl(msg) {
  if (!msg || msg.type !== FOCUS_TRACE_TYPE) return false;

  if (msg.enabled === false) {
    focusTrace("trace-disarmed", {});
    focusTraceRun = null;
    return true;
  }

  if (typeof msg.endpoint === "string" && msg.endpoint) {
    const ttl = Math.min(
      Number.isFinite(msg.ttlMs) && msg.ttlMs > 0 ? msg.ttlMs : FOCUS_TRACE_DEFAULT_TTL_MS,
      FOCUS_TRACE_MAX_TTL_MS
    );
    focusTraceRun = {
      runId: String(msg.runId || "unknown"),
      endpoint: msg.endpoint,
      expiresAt: Date.now() + ttl,
      seq: 0,
    };
    focusTrace("trace-armed", { ttlMs: ttl, worker: "background.js" });
  }

  if (typeof msg.snapshot === "string") {
    focusTrace("windows", () => focusTraceWindows({ label: msg.snapshot }));
  }

  // Teardown between bounded repetitions, never a measurement: the harness
  // names the exact window it watched being created, so a run can repeat an
  // opening scenario without closing anything the operator opened. Only an
  // armed run may ask.
  if (Number.isInteger(msg.closeWindow) && focusTraceActive()) {
    focusTrace("harness-close", { windowId: msg.closeWindow });
    Promise.resolve(chrome.windows.remove(msg.closeWindow)).catch(() => {});
  }
  return true;
}

/**
 * Record one event. `detail` may be a value, a promise, or a thunk returning
 * either — a thunk is only invoked while armed, and nothing on the traced path
 * ever awaits it: the sequence number and timestamp are taken now, the body is
 * filled in later and posted in order.
 */
function focusTrace(event, detail) {
  if (!focusTraceActive()) return;
  const run = focusTraceRun;
  const record = {
    tag: FOCUS_TRACE_TAG,
    runId: run.runId,
    seq: run.seq++,
    t: Date.now(),
    source: "extension",
    event,
  };
  const body = new Promise((resolve) => resolve(typeof detail === "function" ? detail() : detail)).then(
    (value) => Object.assign(record, { detail: value || {} }),
    (err) => Object.assign(record, { detail: { traceError: String((err && err.message) || err) } })
  );
  focusTraceTail = focusTraceTail.then(() => focusTracePost(run, body)).catch(() => {});
}

async function focusTracePost(run, body) {
  const record = await body;
  try {
    await fetch(run.endpoint, {
      method: "POST",
      // text/plain keeps this a CORS-simple request, so the collector never
      // has to answer a preflight.
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(record),
    });
  } catch (_) {
    // A dead collector must never disturb the traced path.
  }
}

/**
 * Every Chromium window as the extension sees it — the identity, type, and
 * focus state the harness pairs with the native z-order reading. Bounds are in
 * the same screen coordinates the probe reports, which is how a Chromium window
 * id gets matched to a CoreGraphics window.
 */
async function focusTraceWindows(extra) {
  let all = [];
  try {
    all = (await chrome.windows.getAll({})) || [];
  } catch (_) {
    all = [];
  }
  const windows = [];
  for (const win of all) {
    if (!win || win.id === undefined) continue;
    let isLil = false;
    try {
      isLil = await focusTraceIsLil(win.id);
    } catch (_) {
      isLil = false;
    }
    windows.push({
      id: win.id,
      type: win.type,
      focused: !!win.focused,
      state: win.state,
      incognito: !!win.incognito,
      isLil,
      bounds: { left: win.left, top: win.top, width: win.width, height: win.height },
    });
  }
  return Object.assign({ windows }, extra || {});
}
