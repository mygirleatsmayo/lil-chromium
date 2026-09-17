// LILFOCUS scenario matrix (issue #30).
//
// Pins the coverage the issue asks for, so a later edit cannot quietly drop a
// case and still report green.

import { test } from "node:test";
import assert from "node:assert/strict";

import { SCENARIOS, gestures, needsOperator, selectScenarios } from "./scenarios.mjs";

test("the close matrix covers all three cases #30 names", () => {
  assert.deepEqual(
    SCENARIOS.filter((s) => s.kind === "close").map((s) => s.id),
    ["close/immediate", "close/switch-then-refocus", "close/unfocused-red-button"]
  );
});

test("the open matrix covers both arrangements against all three neighbour states", () => {
  const open = SCENARIOS.filter((s) => s.kind === "open");
  assert.equal(open.length, 6);
  for (const arrangement of ["same-display", "cross-display"]) {
    for (const neighbours of ["no-other-lil", "lil-on-source-display", "lil-on-primary-display"]) {
      assert.ok(open.some((s) => s.id === `open/${arrangement}/${neighbours}`), `${arrangement}/${neighbours}`);
    }
  }
});

test("opening runs repetitions because the symptom is intermittent; every step is read", () => {
  for (const s of SCENARIOS) {
    assert.ok(s.defaultReps >= 2, `${s.id} repeats`);
    for (const step of s.steps) assert.ok(step.probe, `${s.id} reads after every step`);
  }
  assert.ok(SCENARIOS.filter((s) => s.kind === "open").every((s) => s.defaultReps >= 3));
});

test("only the close cases need a person; opening is fully automatic", () => {
  assert.equal(SCENARIOS.filter((s) => s.kind === "open").some(needsOperator), false);
  assert.equal(SCENARIOS.filter((s) => s.kind === "close").every(needsOperator), true);
});

test("scenarios can be selected by exact id or by prefix", () => {
  assert.deepEqual(selectScenarios("close/immediate").map((s) => s.id), ["close/immediate"]);
  assert.equal(selectScenarios("open").length, 6);
  assert.equal(selectScenarios("close,open/same-display").length, 6);
  assert.equal(selectScenarios().length, SCENARIOS.length);
});

test("no gesture is ever followed by a keystroke: completion is detected, not announced", () => {
  for (const step of SCENARIOS.flatMap((s) => s.steps)) {
    assert.notEqual(step.do, "ask", "an Enter-in-the-terminal step is itself a focus change before capture");
    if (step.do === "await") {
      assert.ok(step.prompt, "an awaited gesture still tells the operator what to do");
      assert.ok(["lil-closed", "lil-focused"].includes(step.until), `${step.until} is observable`);
    }
  }
});

test("the unfocused red-button case asks for the red button and nothing else", () => {
  const scenario = SCENARIOS.find((s) => s.id === "close/unfocused-red-button");
  const asked = gestures(scenario);

  assert.equal(asked.length, 1);
  assert.equal(asked[0].until, "lil-closed");
  assert.match(asked[0].prompt, /red close control/);
  assert.doesNotMatch(asked[0].prompt, /Enter|return to|refocus/i);
});
