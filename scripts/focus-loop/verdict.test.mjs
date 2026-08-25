// LILFOCUS verdict engine (issue #30).
//
// These tests are the loop's own red/green proof: they state the two reported
// v0.4 symptoms as window readings and require the engine to call them red,
// and they state the intended behaviour and require green. Without this, "the
// command ran" and "the command can catch the bug" are indistinguishable.

import { test } from "node:test";
import assert from "node:assert/strict";

import { closeVerdict, matchProbeWindow, openVerdict, risenSiblings, scenarioVerdict } from "./verdict.mjs";

const HELIUM = "net.imput.helium";

const DISPLAYS = [
  { index: 0, frame: { x: 0, y: 0, w: 3840, h: 2160 }, isPrimary: true },
  { index: 1, frame: { x: 0, y: -2160, w: 3840, h: 2160 }, isPrimary: false },
];

/** A native reading: windows listed front to back. */
function snap(label, windows, frontmost) {
  return {
    tag: "LILFOCUS",
    source: "probe",
    label,
    t: 0,
    displays: DISPLAYS,
    frontmost,
    windows: windows.map((w, order) => ({
      order,
      display: 0,
      bounds: { x: 0, y: 0, w: 100, h: 100 },
      owner: w.bundleId,
      ...w,
    })),
  };
}

const MAIL = { number: 10, pid: 1, bundleId: "com.apple.mail" };
const PRIMARY = { number: 20, pid: 2, bundleId: HELIUM };
const OTHER_LIL = { number: 30, pid: 2, bundleId: HELIUM, display: 1 };
const TERMINAL = { number: 40, pid: 3, bundleId: "com.cmuxterm.app" };
const NEW_LIL = { number: 99, pid: 2, bundleId: HELIUM, bounds: { x: 500, y: 400, w: 1100, h: 800 } };

const front = (bundleId) => ({ pid: 1, bundleId, name: bundleId });

test("opening: only the requested lil coming forward is green", () => {
  const result = openVerdict({
    before: snap("before", [MAIL, PRIMARY], front("com.apple.mail")),
    after: snap("after", [NEW_LIL, MAIL, PRIMARY], front(HELIUM)),
    bundleId: HELIUM,
    createdBounds: { left: 500, top: 400, width: 1100, height: 800 },
  });

  assert.equal(result.verdict, "green");
  assert.equal(result.lilIsFrontWindow, true);
  assert.deepEqual(result.risenSiblings, []);
});

test("opening: the Primary window rising with the lil is red and is named", () => {
  const result = openVerdict({
    // Mail is in front of Primary…
    before: snap("before", [MAIL, PRIMARY], front("com.apple.mail")),
    // …and after the open, Primary has overtaken it.
    after: snap("after", [NEW_LIL, PRIMARY, MAIL], front(HELIUM)),
    bundleId: HELIUM,
    createdBounds: { left: 500, top: 400, width: 1100, height: 800 },
  });

  assert.equal(result.verdict, "red");
  assert.deepEqual(
    result.risenSiblings.map((s) => s.number),
    [PRIMARY.number]
  );
  assert.deepEqual(result.risenSiblings[0].overtook.map((w) => w.bundleId), ["com.apple.mail"]);
});

test("opening: an existing lil rising on the other display is red too", () => {
  const result = openVerdict({
    before: snap("before", [MAIL, TERMINAL, OTHER_LIL, PRIMARY], front("com.apple.mail")),
    after: snap("after", [NEW_LIL, MAIL, OTHER_LIL, TERMINAL, PRIMARY], front(HELIUM)),
    bundleId: HELIUM,
    createdBounds: { left: 500, top: 400, width: 1100, height: 800 },
  });

  assert.equal(result.verdict, "red");
  assert.deepEqual(
    result.risenSiblings.map((s) => s.number),
    [OTHER_LIL.number]
  );
});

test("opening: a lil that never appeared is inconclusive, never green", () => {
  const result = openVerdict({
    before: snap("before", [MAIL, PRIMARY], front("com.apple.mail")),
    after: snap("after", [MAIL, PRIMARY], front("com.apple.mail")),
    bundleId: HELIUM,
    createdBounds: { left: 500, top: 400, width: 1100, height: 800 },
  });

  assert.equal(result.verdict, "inconclusive");
});

test("opening: the created lil is identified by its bounds, not by being newest", () => {
  const decoy = { number: 98, pid: 2, bundleId: HELIUM, bounds: { x: 0, y: 0, w: 400, h: 400 } };
  const result = openVerdict({
    before: snap("before", [MAIL, PRIMARY], front("com.apple.mail")),
    after: snap("after", [decoy, NEW_LIL, MAIL, PRIMARY], front(HELIUM)),
    bundleId: HELIUM,
    createdBounds: { left: 500, top: 400, width: 1100, height: 800 },
  });

  assert.equal(result.lil.number, NEW_LIL.number);
});

test("closing: returning to the app that was in front is green", () => {
  const result = closeVerdict({
    before: snap("before", [TERMINAL, PRIMARY], front("com.cmuxterm.app")),
    after: snap("afterClose", [TERMINAL, PRIMARY], front("com.cmuxterm.app")),
    bundleId: HELIUM,
    expectedBundleId: "com.cmuxterm.app",
  });

  assert.equal(result.verdict, "green");
  assert.equal(result.landedOnBrowser, false);
});

test("closing: landing on the browser instead of the prior app is red", () => {
  const result = closeVerdict({
    before: snap("before", [TERMINAL, PRIMARY], front("com.cmuxterm.app")),
    after: snap("afterClose", [PRIMARY, TERMINAL], front(HELIUM)),
    bundleId: HELIUM,
    expectedBundleId: "com.cmuxterm.app",
  });

  assert.equal(result.verdict, "red");
  assert.equal(result.landedOnBrowser, true);
  assert.match(result.reason, /net\.imput\.helium.*instead of com\.cmuxterm\.app/);
  assert.deepEqual(
    result.risenSiblings.map((s) => s.number),
    [PRIMARY.number],
    "the trace also names which sibling came forward"
  );
});

test("closing: no captured expectation is inconclusive, never green", () => {
  const result = closeVerdict({
    before: snap("before", [TERMINAL], front("com.cmuxterm.app")),
    after: snap("afterClose", [TERMINAL], undefined),
    bundleId: HELIUM,
    expectedBundleId: undefined,
  });

  assert.equal(result.verdict, "inconclusive");
});

test("a window the browser closed is never counted as having risen", () => {
  const risen = risenSiblings({
    before: snap("before", [MAIL, PRIMARY], front("com.apple.mail")),
    after: snap("after", [MAIL], front("com.apple.mail")),
    bundleId: HELIUM,
  });

  assert.deepEqual(risen, []);
});

test("bounds matching refuses a window that is nowhere near the reported one", () => {
  const windows = snap("after", [NEW_LIL], front(HELIUM)).windows;
  assert.equal(matchProbeWindow(windows, { left: 500, top: 400, width: 1100, height: 800 }).number, 99);
  assert.equal(matchProbeWindow(windows, { left: 0, top: 0, width: 300, height: 300 }), null);
});

test("intermittent behaviour reports a reproduction rate, and a gap never reads green", () => {
  assert.deepEqual(scenarioVerdict([{ verdict: "red" }, { verdict: "green" }, { verdict: "red" }]), {
    verdict: "red",
    reproductions: 2,
    repetitions: 3,
    inconclusive: 0,
    rate: 0.667,
  });
  assert.equal(scenarioVerdict([{ verdict: "green" }, { verdict: "green" }]).verdict, "green");
  assert.equal(scenarioVerdict([{ verdict: "green" }, { verdict: "inconclusive" }]).verdict, "inconclusive");
  assert.equal(scenarioVerdict([]).verdict, "inconclusive");
});
