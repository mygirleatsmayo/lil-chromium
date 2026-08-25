// LILFOCUS — behavior-neutral diagnostic seam for issue #30's real-Mac focus loop.
//
// The two v0.4 focus regressions (a closing lil restores the wrong Helium
// sibling; an opening lil raises an unrelated sibling) can only be told apart
// with the extension's own view: which windows existed, which one Chromium
// considered focused, which predecessor was chosen, and what was asked to take
// focus on close. None of that is observable from outside the browser, so this
// module streams it to a local collector that `scripts/focus-loop.mjs` runs.
//
// It is a private diagnostic control, documented as such in docs/PROTOCOL.md and
// validated by the host before it ever reaches here. Discipline, so it can stay
// in the tree without becoming product behavior:
//
//   - Inert until armed. Arming arrives over the relay socket, never from a page
//     and never from storage — a worker restart disarms it.
//   - Every arm carries a TTL, so a forgotten run stops tracing on its own.
//   - The collector is *derived*, never supplied: loopback, on the run's port,
//     under the run's own path. A message cannot redirect the stream.
//   - The one mutating operation can close only a lil this armed run itself
//     opened and that is still registered — never Primary, never a foreign lil,
//     never a stale id.
//   - No awaits on the traced code path and every failure swallowed, so an
//     armed worker behaves exactly like a disarmed one.
//
// Cleanup check: `node scripts/focus-loop.mjs cleanup`.

const FOCUS_TRACE_TAG = "LILFOCUS";
const FOCUS_TRACE_TYPE = "lil-focus-trace"; // control message type over the relay
const FOCUS_TRACE_MAX_TTL_MS = 30 * 60 * 1000;
const FOCUS_TRACE_DEFAULT_TTL_MS = 15 * 60 * 1000;
// A run id is a path segment of the derived collector URL, so it is restricted
// to characters that cannot leave that segment.
const FOCUS_TRACE_RUN_ID = /^[A-Za-z0-9._-]{1,64}$/;

// null while disarmed. { runId, endpoint, expiresAt, seq, ownedLils }
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
 * unknown. One tagged `op` per message, each with only its own payload:
 *
 *   {op:"arm",       runId, port, ttlMs?}
 *   {op:"disarm"}
 *   {op:"snapshot",  label}
 *   {op:"close-lil", runId, windowId}
 *
 * Anything else — an unknown op, a malformed payload — is consumed and ignored.
 */
function focusTraceControl(msg) {
  if (!msg || msg.type !== FOCUS_TRACE_TYPE) return false;

  switch (msg.op) {
    case "arm":
      focusTraceArm(msg);
      break;
    case "disarm":
      focusTrace("trace-disarmed", {});
      focusTraceRun = null;
      break;
    case "snapshot":
      if (typeof msg.label === "string" && msg.label) {
        focusTrace("windows", () => focusTraceWindows({ label: msg.label }));
      }
      break;
    case "close-lil":
      focusTraceCloseLil(msg);
      break;
  }
  return true;
}

/** Begin a run, or leave the seam exactly as it was if the arm is untrustworthy. */
function focusTraceArm(msg) {
  const runId = typeof msg.runId === "string" && FOCUS_TRACE_RUN_ID.test(msg.runId) ? msg.runId : null;
  const port = Number.isInteger(msg.port) && msg.port > 0 && msg.port <= 65535 ? msg.port : null;
  if (!runId || !port) return;

  const ttl = Math.min(
    Number.isFinite(msg.ttlMs) && msg.ttlMs > 0 ? msg.ttlMs : FOCUS_TRACE_DEFAULT_TTL_MS,
    FOCUS_TRACE_MAX_TTL_MS
  );
  focusTraceRun = {
    runId,
    // Derived, never supplied: the stream can only reach this machine, on the
    // port the run opened, under the run's own path.
    endpoint: `http://127.0.0.1:${port}/t/${runId}`,
    expiresAt: Date.now() + ttl,
    seq: 0,
    ownedLils: new Set(),
  };
  focusTrace("trace-armed", { ttlMs: ttl, worker: "background.js" });
}

/**
 * Teardown between bounded repetitions, never a measurement: an opening
 * scenario must be able to repeat from the arrangement it confirmed. The armed
 * run may close only a lil it opened itself and that is still a registered lil,
 * so a wrong, foreign, or stale id — Primary included — is inert and says so.
 */
function focusTraceCloseLil(msg) {
  if (!focusTraceActive()) return;
  const run = focusTraceRun;
  if (msg.runId !== run.runId || !Number.isInteger(msg.windowId)) return;

  if (!run.ownedLils.has(msg.windowId)) {
    focusTrace("harness-close", { windowId: msg.windowId, outcome: "not-owned-by-this-run" });
    return;
  }
  focusTrace("harness-close", () => focusTraceRemoveOwnedLil(run, msg.windowId));
}

/**
 * Close one lil this run owns, and say what happened to it.
 *
 * Ownership is dropped only after a confirmed close or a terminal stale/not-lil
 * outcome — a failed `windows.remove` keeps the id so the final sweep can retry.
 */
async function focusTraceRemoveOwnedLil(run, windowId) {
  if (!(await focusTraceIsLil(windowId))) {
    run.ownedLils.delete(windowId);
    return { windowId, outcome: "no-longer-a-registered-lil" };
  }
  try {
    await chrome.windows.remove(windowId);
    run.ownedLils.delete(windowId);
    return { windowId, outcome: "closed" };
  } catch (_) {
    return { windowId, outcome: "close-failed" };
  }
}

/**
 * Trace a lil this run caused to exist, and remember it as the only window the
 * run is allowed to tear down again.
 */
function focusTraceLilCreated(windowId, detail) {
  if (focusTraceActive() && Number.isInteger(windowId)) focusTraceRun.ownedLils.add(windowId);
  focusTrace("lil-created", detail);
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
