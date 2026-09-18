// LILFOCUS scenario matrix (issue #30), stated once so the live run, the
// replay, and the evidence document cannot drift apart.
//
// A step is either:
//   { do: "activate", app: "source"|"switch" }   harness activates that app
//   { do: "open" }                                harness opens a lil through
//                                                 the real default-browser path,
//                                                 the way the scenario's `launch`
//                                                 says (see LAUNCHES)
//   { do: "await", prompt, until }                the operator's gesture, which
//                                                 the run watches the seam for
// and every step ends with a probe reading under `probe`.
//
// Only gestures the harness genuinely cannot perform are `await` steps: macOS
// gives no permission-free way to press ⌘W or click a window's close control,
// and this tooling deliberately claims no Accessibility permission.
//
// An `await` step asks for the gesture and nothing else. It never asks for a
// keystroke to confirm, because pressing Enter in a terminal *is* an
// application activation, and it would land between the gesture under test and
// the reading that scores it — turning a correct restore into a false red.
// `until` names the seam event that says the gesture happened:
// "lil-closed" (the lil's window went away) or "lil-focused" (it came forward).

/**
 * How the URL reaches the default browser. A link clicked in Mail activates
 * the URL handler (`/usr/bin/open <url>`); `open -g` leaves the source app in
 * front, which the loop used for every scenario until the 2026-09-17 live run
 * showed a Mail click arriving with the app itself frontmost (issue #31).
 */
export const LAUNCHES = {
  activating: { describe: () => "the lil is opened activating (`open <url>`), the path a clicked link takes" },
  background: { describe: () => "the lil is opened in the background (`open -g <url>`), the source app kept in front" },
};

/** Arrangements the operator sets up once per scenario, then the harness verifies. */
const ARRANGEMENTS = {
  "same-display": {
    describe: (source) => `${source} and the Helium Primary window on the SAME display`,
    check: ({ sourceDisplay, primaryDisplay }) =>
      sourceDisplay !== null && primaryDisplay !== null && sourceDisplay === primaryDisplay,
  },
  "cross-display": {
    describe: (source) => `${source} and the Helium Primary window on DIFFERENT displays`,
    check: ({ sourceDisplay, primaryDisplay }) =>
      sourceDisplay !== null && primaryDisplay !== null && sourceDisplay !== primaryDisplay,
  },
};

/** Neighbouring-lil conditions, which decide which sibling can be raised. */
const NEIGHBOURS = {
  "no-other-lil": {
    describe: () => "no other lil open anywhere",
    check: ({ lilDisplays }) => lilDisplays.length === 0,
  },
  "lil-on-source-display": {
    describe: (source) => `one existing lil on ${source}'s display (cover it with another app)`,
    check: ({ lilDisplays, sourceDisplay }) => lilDisplays.includes(sourceDisplay),
  },
  "lil-on-primary-display": {
    describe: () => "one existing lil on the Helium Primary window's display",
    check: ({ lilDisplays, primaryDisplay }) => lilDisplays.includes(primaryDisplay),
  },
};

function openScenario(arrangement, neighbours) {
  return {
    id: `open/${arrangement}/${neighbours}`,
    kind: "open",
    // Opening was reported as intermittent, so it carries the repetitions.
    defaultReps: 3,
    // The recorded #30 evidence was measured under a background open; the
    // opening symptom is scored on z-order alone, so that measurement stands.
    launch: "background",
    summary: `open a lil from the source app; ${LAUNCHES.background.describe()}`,
    arrangement: { ...ARRANGEMENTS[arrangement], id: arrangement },
    neighbours: { ...NEIGHBOURS[neighbours], id: neighbours },
    steps: [
      { do: "activate", app: "source", probe: "before" },
      { do: "open", probe: "after" },
    ],
  };
}

/** The complete #30 opening matrix: two arrangements x three neighbour states. */
const OPEN_SCENARIOS = Object.keys(ARRANGEMENTS).flatMap((arrangement) =>
  Object.keys(NEIGHBOURS).map((neighbours) => openScenario(arrangement, neighbours))
);

/** The three close cases #30 names, each ending in a gesture only a human can make. */
const CLOSE_CASES = {
  immediate: {
    summary: "close a focused lil immediately after opening it from an external app",
    // The app in front when the lil was requested is the context to return to.
    expectedFrom: "before",
    steps: [
      { do: "activate", app: "source", probe: "before" },
      { do: "open", probe: "afterOpen" },
      {
        do: "await",
        prompt: "Close the focused lil (⌘W, or click its red close control).",
        until: "lil-closed",
        probe: "afterClose",
      },
    ],
  },
  "switch-then-refocus": {
    summary: "switch to another app, refocus the lil, then close it",
    // ADR-0004: the context preceding the lil's *current* focused run.
    expectedFrom: "afterSwitch",
    steps: [
      { do: "activate", app: "source", probe: "before" },
      { do: "open", probe: "afterOpen" },
      { do: "activate", app: "switch", probe: "afterSwitch" },
      {
        do: "await",
        prompt: "Click the lil once to refocus it. Do not close it yet.",
        until: "lil-focused",
        probe: "afterRefocus",
      },
      {
        do: "await",
        prompt: "Now close the focused lil (⌘W, or click its red close control).",
        until: "lil-closed",
        probe: "afterClose",
      },
    ],
  },
  "unfocused-red-button": {
    summary: "close a background lil with only its red control, never focusing it",
    // Nothing should move: the active app was never left.
    expectedFrom: "afterSwitch",
    steps: [
      { do: "activate", app: "source", probe: "before" },
      { do: "open", probe: "afterOpen" },
      { do: "activate", app: "switch", probe: "afterSwitch" },
      {
        // One gesture, and nothing after it: the run notices the lil is gone.
        do: "await",
        prompt:
          "WITHOUT focusing the lil first, click ONLY its red close control " +
          "(one click on the button itself). That is the whole gesture.",
        until: "lil-closed",
        probe: "afterClose",
      },
    ],
  },
};

// The product path keeps the ids the recorded traces carry; a comparison
// launch is named in its id so a `close/<case>` filter never selects it.
function closeScenario(name, launch) {
  const closeCase = CLOSE_CASES[name];
  return {
    id: launch === "activating" ? `close/${name}` : `close/${launch}/${name}`,
    kind: "close",
    defaultReps: 2,
    launch,
    summary: `${closeCase.summary}; ${LAUNCHES[launch].describe()}`,
    expectedFrom: closeCase.expectedFrom,
    steps: closeCase.steps,
  };
}

/** Every close case on the activating open, plus one background comparison. */
const CLOSE_SCENARIOS = [
  ...Object.keys(CLOSE_CASES).map((name) => closeScenario(name, "activating")),
  closeScenario("immediate", "background"),
];

export const SCENARIOS = [...CLOSE_SCENARIOS, ...OPEN_SCENARIOS];

export function selectScenarios(filter) {
  if (!filter) return SCENARIOS;
  const patterns = filter.split(",").map((s) => s.trim()).filter(Boolean);
  return SCENARIOS.filter((s) => patterns.some((p) => s.id === p || s.id.startsWith(p)));
}

/** The gestures a person has to make for this scenario, in order. */
export function gestures(scenario) {
  return scenario.steps.filter((step) => step.do === "await");
}

/** True when the scenario needs a person at the Mac. */
export function needsOperator(scenario) {
  return gestures(scenario).length > 0;
}
