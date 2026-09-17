// LILFOCUS scenario matrix (issue #30), stated once so the live run, the
// replay, and the evidence document cannot drift apart.
//
// A step is either:
//   { do: "activate", app: "source"|"switch" }   harness activates that app
//   { do: "open" }                                harness opens a lil through
//                                                 the real default-browser path
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
const CLOSE_SCENARIOS = [
  {
    id: "close/immediate",
    kind: "close",
    defaultReps: 2,
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
  {
    id: "close/switch-then-refocus",
    kind: "close",
    defaultReps: 2,
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
  {
    id: "close/unfocused-red-button",
    kind: "close",
    defaultReps: 2,
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
