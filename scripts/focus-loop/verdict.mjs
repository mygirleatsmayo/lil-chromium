// LILFOCUS verdict engine (issue #30).
//
// The two v0.4 focus regressions are both z-order facts, and neither is
// visible to Chromium:
//
//   - Opening a lil raises an unrelated Helium sibling. Chromium only ever
//     reports one focused window, so "another window came forward" has no API.
//   - Closing a focused lil lands on the wrong app. Chromium cannot say which
//     application macOS made frontmost afterwards.
//
// So the oracle reads the native window list instead: a Helium window "rose"
// when it overtook a window of some other application that used to be in front
// of it. That is exactly the symptom Lucas reported, stated in a form a machine
// can decide.
//
// Everything here is pure over probe snapshots (see mac/Sources/LilFocusProbe)
// so the same functions score a live run and a replayed trace identically.

/** Front-to-back position per CoreGraphics window number. */
function orderByNumber(snapshot) {
  const map = new Map();
  for (const win of snapshot.windows) map.set(win.number, win.order);
  return map;
}

/** Windows present after the gesture but not before, owned by `bundleId`. */
export function newWindows({ before, after, bundleId }) {
  const seen = new Set(before.windows.map((w) => w.number));
  return after.windows.filter((w) => w.bundleId === bundleId && !seen.has(w.number));
}

/**
 * Pair a Chromium window with the native window at the same place. Chromium
 * reports a window's outer top-left and size in the same screen space the probe
 * uses, so bounds are the only identity the two views share.
 */
export function matchProbeWindow(probeWindows, bounds, tolerance = 12) {
  if (!bounds || typeof bounds.left !== "number") return null;
  let best = null;
  let bestDistance = Infinity;
  for (const win of probeWindows) {
    const distance =
      Math.abs(win.bounds.x - bounds.left) +
      Math.abs(win.bounds.y - bounds.top) +
      Math.abs(win.bounds.w - bounds.width) +
      Math.abs(win.bounds.h - bounds.height);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = win;
    }
  }
  return bestDistance <= tolerance * 4 ? best : null;
}

/**
 * Every window of `bundleId` that overtook another application's window.
 * `ignore` holds the native window numbers that are *allowed* to come forward —
 * in practice the lil the gesture just asked for.
 */
export function risenSiblings({ before, after, bundleId, ignore = [] }) {
  const beforeOrder = orderByNumber(before);
  const afterOrder = orderByNumber(after);
  const exempt = new Set(ignore);
  const foreign = before.windows.filter((w) => w.bundleId !== bundleId && afterOrder.has(w.number));

  const risen = [];
  for (const sibling of before.windows) {
    if (sibling.bundleId !== bundleId) continue;
    if (exempt.has(sibling.number)) continue;
    if (!afterOrder.has(sibling.number)) continue;

    const overtook = foreign
      .filter(
        (other) =>
          beforeOrder.get(other.number) < beforeOrder.get(sibling.number) &&
          afterOrder.get(other.number) > afterOrder.get(sibling.number)
      )
      .map((other) => ({ number: other.number, bundleId: other.bundleId, owner: other.owner }));

    if (overtook.length) {
      risen.push({
        number: sibling.number,
        display: sibling.display,
        orderBefore: beforeOrder.get(sibling.number),
        orderAfter: afterOrder.get(sibling.number),
        overtook,
      });
    }
  }
  return risen;
}

/**
 * Opening scenario: the requested lil must come forward and nothing else of the
 * browser's may.
 *
 * `createdBounds` is what the extension said it created, so the lil is exempted
 * by identity rather than by "the newest window", which would silently exempt a
 * sibling that Chromium happened to recreate.
 */
export function openVerdict({ before, after, bundleId, createdBounds }) {
  const created = newWindows({ before, after, bundleId });
  const matched = createdBounds ? matchProbeWindow(created, createdBounds) : null;
  const lil = matched || (created.length === 1 ? created[0] : null);

  const risen = risenSiblings({
    before,
    after,
    bundleId,
    ignore: lil ? [lil.number] : created.map((w) => w.number),
  });

  if (!lil) {
    return {
      verdict: "inconclusive",
      reason: created.length ? "could not identify the created lil" : "no new browser window appeared",
      risenSiblings: risen,
    };
  }

  const frontmostIsBrowser = after.frontmost && after.frontmost.bundleId === bundleId;
  return {
    verdict: risen.length ? "red" : "green",
    reason: risen.length
      ? `${risen.length} unrelated ${bundleId} window(s) came forward with the lil`
      : "only the requested lil came forward",
    lil: { number: lil.number, display: lil.display, order: lil.order },
    lilIsFrontWindow: lil.order === 0,
    frontmostApp: after.frontmost || null,
    frontmostIsBrowser: !!frontmostIsBrowser,
    risenSiblings: risen,
  };
}

/**
 * Closing scenario: the lil behaves like an independent app (ADR-0004), so the
 * application that was in front before the lil took focus must be in front
 * again. Landing on the browser is the reported regression.
 */
export function closeVerdict({ before, after, bundleId, expectedBundleId }) {
  const actual = after.frontmost || null;
  const risen = risenSiblings({ before, after, bundleId });

  if (!expectedBundleId) {
    return { verdict: "inconclusive", reason: "no expected application was captured", risenSiblings: risen };
  }
  const restored = !!actual && actual.bundleId === expectedBundleId;
  return {
    verdict: restored ? "green" : "red",
    reason: restored
      ? `focus returned to ${expectedBundleId}`
      : `focus landed on ${(actual && actual.bundleId) || "nothing"} instead of ${expectedBundleId}`,
    expected: expectedBundleId,
    actual,
    landedOnBrowser: !!actual && actual.bundleId === bundleId,
    risenSiblings: risen,
  };
}

/**
 * Fold a scenario's repetitions into one verdict plus the reproduction rate the
 * ticket asks for. Any repetition the harness could not score keeps the whole
 * scenario inconclusive — a missing observation must never read as green.
 */
export function scenarioVerdict(reps) {
  const total = reps.length;
  const red = reps.filter((r) => r.verdict === "red").length;
  const inconclusive = reps.filter((r) => r.verdict === "inconclusive").length;
  const verdict = red > 0 ? "red" : total === 0 || inconclusive > 0 ? "inconclusive" : "green";
  return {
    verdict,
    reproductions: red,
    repetitions: total,
    inconclusive,
    rate: total ? Number((red / total).toFixed(3)) : 0,
  };
}
