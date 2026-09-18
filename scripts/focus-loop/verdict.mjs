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

/** The display index of the frontmost window belonging to `bundleId`. */
export function displayOfApp(snapshot, bundleId) {
  const win = snapshot.windows.find((w) => w.bundleId === bundleId);
  return win ? win.display : null;
}

/**
 * Where the browser's own windows sit, by pairing the extension's window list
 * (which knows what is a lil and what is Primary) with the native reading
 * (which knows what display each window is on). This is how an arrangement the
 * operator was asked to set up gets confirmed before anything is scored.
 */
export function browserLayout(snapshot, extensionWindows, bundleId) {
  const browserWindows = snapshot.windows.filter((w) => w.bundleId === bundleId);
  const place = (win) => {
    const match = matchProbeWindow(browserWindows, win.bounds);
    return match ? match.display : null;
  };
  const primary = extensionWindows.find((w) => w.type === "normal" && !w.isLil);
  return {
    primaryDisplay: primary ? place(primary) : null,
    lilDisplays: extensionWindows.filter((w) => w.isLil).map(place).filter((d) => d !== null),
  };
}

/**
 * Opening scenario. Three independent requirements, all of which #30 names:
 *
 *   1. The requested lil landed on the display of the application it was opened
 *      from. A lil that appears on the Primary window's display instead is the
 *      cross-display symptom, and it shows even when nothing overtook anything.
 *   2. It was left as the focused front window of the browser.
 *   3. No *other* browser window came forward. This is computed from the raw
 *      z-order alone, so it stays true whether or not the lil was identified.
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

  // The `before` reading is taken with the source application activated, so its
  // frontmost app is the application the lil is opened from.
  const sourceApp = before.frontmost || null;
  const sourceDisplay = sourceApp ? displayOfApp(before, sourceApp.bundleId) : null;
  const frontmostIsBrowser = !!after.frontmost && after.frontmost.bundleId === bundleId;
  const lilIsFrontWindow = lil.order === 0;
  const observed = {
    lil: { number: lil.number, display: lil.display, order: lil.order },
    sourceApp,
    sourceDisplay,
    onSourceDisplay: sourceDisplay !== null && lil.display === sourceDisplay,
    lilIsFrontWindow,
    frontmostApp: after.frontmost || null,
    frontmostIsBrowser,
    risenSiblings: risen,
  };

  if (sourceDisplay === null) {
    return { verdict: "inconclusive", reason: "could not read the source application's display", ...observed };
  }

  const faults = [];
  if (!observed.onSourceDisplay) {
    faults.push(`the lil opened on display ${lil.display} instead of the source application's display ${sourceDisplay}`);
  }
  if (!lilIsFrontWindow || !frontmostIsBrowser) {
    faults.push("the requested lil is not the focused front window");
  }
  if (risen.length) {
    faults.push(`${risen.length} unrelated ${bundleId} window(s) came forward with the lil`);
  }

  return {
    verdict: faults.length ? "red" : "green",
    reason: faults.length ? faults.join("; ") : "only the requested lil came forward, on the source display",
    ...observed,
  };
}

/**
 * Closing scenario: the lil behaves like an independent app (ADR-0004), so the
 * application that was in front before the lil took focus must be in front
 * again, and the rest of the z-order must be as the user left it. Landing on
 * the browser is the reported regression; a sibling that rose behind the
 * restored app is the flash the 2026-09-17 live run read green (issue #31).
 */
export function closeVerdict({ before, after, bundleId, expectedBundleId }) {
  const actual = after.frontmost || null;
  const risen = risenSiblings({ before, after, bundleId });

  if (!expectedBundleId) {
    return { verdict: "inconclusive", reason: "no expected application was captured", risenSiblings: risen };
  }
  const restored = !!actual && actual.bundleId === expectedBundleId;
  const faults = [];
  if (!restored) {
    faults.push(`focus landed on ${(actual && actual.bundleId) || "nothing"} instead of ${expectedBundleId}`);
  }
  if (risen.length) {
    const named = risen.map((s) => `window ${s.number} from ${s.orderBefore} to ${s.orderAfter}`).join(", ");
    faults.push(`${risen.length} ${bundleId} window(s) rose above another application's: ${named}`);
  }
  return {
    verdict: faults.length ? "red" : "green",
    reason: faults.length ? faults.join("; ") : `focus returned to ${expectedBundleId} and no browser window rose`,
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

/**
 * An opening repetition whose lil is still open has broken the arrangement the
 * next one would be scored against. `closed` and `nothing-to-close` keep going;
 * any other teardown outcome stops the scenario with one recorded inconclusive.
 */
export function teardownInconclusive(rep) {
  if (!rep || !rep.teardown || rep.teardown === "closed" || rep.teardown === "nothing-to-close") return null;
  return {
    repetition: rep.repetition + 1,
    verdict: "inconclusive",
    reason: `teardown reported "${rep.teardown}", so the confirmed arrangement no longer holds`,
  };
}

/**
 * Score one repetition's collected probes and creations.
 *
 * The native reading alone decides the verdict, so the loop still scores a
 * browser running an uninstrumented build — the extension's own report of what
 * it created only sharpens which new window was the lil when several appeared.
 */
export function scoreRepetition({ scenario, probes, created, bundleId }) {
  const kind = (scenario && scenario.kind) || "open";
  const needed = kind === "open" ? ["before", "after"] : ["before", "afterClose"];
  const missing = needed.filter((label) => !probes[label]);
  if (missing.length) {
    return { verdict: "inconclusive", reason: `missing native reading(s): ${missing.join(", ")}` };
  }

  const lastCreated = created[created.length - 1] || null;
  if (kind === "open") {
    return {
      identifiedBy: lastCreated ? "extension" : "native",
      ...openVerdict({
        before: probes.before,
        after: probes.after,
        bundleId,
        createdBounds: lastCreated && lastCreated.bounds,
      }),
    };
  }

  const expectedFrom = (scenario && scenario.expectedFrom) || "before";
  const expected = probes[expectedFrom];
  return closeVerdict({
    before: probes.before,
    after: probes.afterClose,
    bundleId,
    expectedBundleId: expected && expected.frontmost && expected.frontmost.bundleId,
  });
}

/**
 * Fold scored repetitions into the whole-run result. The live run and a replay
 * both end here, so an artifact can never disagree with the run that wrote it.
 *
 * `entries` are `{ scenario, kind, repetitions }` in report order.
 */
export function foldRun(entries) {
  const scenarios = entries.map(({ scenario, kind, repetitions }) => ({
    scenario,
    kind,
    ...scenarioVerdict(repetitions),
    repetitions,
  }));
  const counts = { red: 0, green: 0, inconclusive: 0 };
  for (const s of scenarios) counts[s.verdict]++;
  return { counts, overall: counts.red ? "red" : counts.inconclusive ? "inconclusive" : "green", scenarios };
}
