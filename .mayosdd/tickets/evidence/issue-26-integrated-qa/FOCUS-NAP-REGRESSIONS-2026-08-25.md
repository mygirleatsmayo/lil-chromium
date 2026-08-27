# v0.4 live QA — focus and Lil Nap regressions

## Status

Real-Mac QA on 2026-08-24 and 2026-08-25 found three release-blocking v0.4 regressions:

1. Closing a focused lil restores a Helium sibling instead of the user's actual prior context.
2. Opening a lil can raise an unrelated Helium sibling, with display placement and the previously key Helium window affecting the result.
3. Waking a napping lil relocates its URL into Primary and closes the lil.

Published issue graph:

- [#30](https://github.com/mygirleatsmayo/lil-chromium/issues/30) establishes the shared red-capable real-Mac focus loop.
- [#31](https://github.com/mygirleatsmayo/lil-chromium/issues/31) corrects close-time focus history and is blocked by #30.
- [#32](https://github.com/mygirleatsmayo/lil-chromium/issues/32) prevents sibling-window raising on open and is blocked by #30.
- [#33](https://github.com/mygirleatsmayo/lil-chromium/issues/33) keeps Lil Nap wake inside the napping lil and can start immediately.
- All four block integrated release QA #26.

## Environment truth

- The initial trial's `0.3.0` extension label and `lil-chromium-v0.3` directory name were misleading metadata, not evidence that v0.3 code ran.
- On 2026-08-23, that worktree was switched to `trial/v0.4-live` at merge `61d44d4`; the base handoff explicitly records that Helium loaded v0.4 trial code from the old directory name.
- On 2026-08-24, worktrees were reassigned so `lil-chromium-v0.4` held `trial/v0.4-live`; version visibility landed at `6cf3671`.
- The corrected current trial reports extension `0.4.0-trial` and app build `v0.2-192-g6cf3671`.
- Current reproduction used Helium 0.15.7.1. An earlier running process was Helium 0.15.6.1, so any automated v0.3/v0.4 differential must pin the Helium build.
- Lucas reports that v0.3 did not exhibit these opening, closing, or wake regressions.

Sources:

- Base handoff: `/Users/mygirleatsmayo/Obsidian/mygirleatsmayo_vault/11-Projects/lil-chromium/_session-handoff/260823-v04-live-trial-session-log.md`
- Delta handoff: `/Users/mygirleatsmayo/Obsidian/mygirleatsmayo_vault/11-Projects/lil-chromium/_session-handoff/260824-v04-trial-delta-session-log.md`
- Git reflogs for the `lil-chromium-v0.3` and `lil-chromium-v0.4` worktrees

## Required focus semantics

A lil must behave like an independent macOS app:

- Terminal → open lil → close focused lil returns to Terminal.
- Terminal → open lil → Obsidian → refocus lil → close lil returns to Obsidian, not Terminal and not Helium.
- Clicking only a background lil's red close control without first focusing the lil must leave the already-active app in front.
- Nested lils must unwind without raising an unrelated normal browser window.

Creation-time predecessor pinning is rejected. The glossary definition of **Prior context** and ADR-0004 record the corrected product principle. The implementation ticket must finish the invariant table for nested close-driven restoration versus user-driven refocus before coding.

## QA matrix

### Closing a lil

1. Terminal → palette → open lil → immediately close focused lil.
   - Expected: Terminal.
   - Actual: Helium; Primary comes forward.

2. Terminal → palette → open lil → Obsidian → refocus lil → close lil.
   - Expected: Obsidian.
   - Actual: Helium.

3. Same-display Mail and Primary:
   - Mail link opens a focused lil without raising Primary.
   - Closing the focused lil raises Primary in front of Mail.

4. Close without refocusing:
   - Mail link → lil → Terminal → click only the lil's red close control while Terminal remains active.
   - Actual: Terminal remains active.
   - Significance: the unwanted jump depends on the focused-lil restoration path; ordinary window closure alone does not force Helium forward.

5. Different displays, no other lil:
   - After returning to another app, refocusing and closing the Mail lil raises Primary.

6. Different displays, another lil already open:
   - Closing the Mail lil raises the other lil, not Primary.
   - This holds when the other lil is on Mail's display and when it is on Primary's display.
   - Covering the other lil with Terminal before closing the Mail lil still causes that other lil to jump forward.

The restoration target therefore follows Helium's prior internal window context: Primary when it is the relevant sibling, otherwise another lil. The behavior is not Primary-specific.

### Opening a lil

1. Mail and Primary on the same display:
   - The requested lil opens focused.
   - Primary does not rise.

2. Mail and Primary on different displays, no other lil:
   - The requested lil opens focused above Mail.
   - Primary simultaneously rises on its own display.

3. Another lil already open on Mail's display and covered by other apps, Primary on another display:
   - Two repetitions: the requested lil opens focused.
   - Neither Primary nor the existing lil rises.

4. Another lil already open on Primary's display:
   - The requested lil opens focused above Mail.
   - The existing lil rises on the other display; Primary does not.

The sibling that rises can be Primary or another lil. This points to Helium application activation and its previously key sibling window, not special Primary routing.

### Waking a napping lil

- Wake closes the lil and opens its original URL as a tab in Primary.
- Which window ultimately gains focus follows the focus variables above.
- The failure reproduces on the corrected v0.4 trial.
- v0.3 woke in place and did not exhibit this behavior.

## Existing implementation evidence

### Prior-context capture and close

- The native app captures `NSWorkspace.shared.frontmostApplication` before sending an open request.
- The extension then queries Chromium windows. If any Chromium window reports `focused`, it overrides the app-supplied external context and records that Chromium window.
- Closing a lil restores its recorded context only when the extension believes that lil was focused.
- The QA result that an unfocused red-button close leaves Terminal active is consistent with this branch boundary.
- The target mapping—Primary when no other lil is relevant, otherwise the other lil—is consistent with Chromium exposing its internal last-key window while Helium is backgrounded. This remains a hypothesis until a red-capable trace captures both candidates and the stored value.
- A second live possibility is that the correct external app is stored but native activation has no visible effect; targeted trace data must distinguish capture from restoration failure.

### Opening and sibling ordering

- Both v0.3 and v0.4 request a focused popup creation and explicitly focus the created window afterward.
- Public Chromium/macOS research supports an activate-application-then-make-popup-key sequence that can raise the prior key sibling during activation, especially across displays or Spaces.
- Because Lucas did not observe the regression on v0.3, that platform mechanism explains the visible sequence but does not identify the v0.4 regression source. A differential loop must pin Helium and vary extension code.

### Lil Nap wake

- v0.3 navigated the existing nap tab back to the original URL.
- v0.4 creates an inactive fresh tab with an explicit lil `windowId`, later activates it, and removes the nap tab.
- Production does not verify that the returned fresh tab's `windowId` equals the requested lil window.
- The issue #21 Chrome-extension review identified this exact risk as F4: if Chromium relocates the tab, removing the nap tab empties and closes the lil while the URL survives in another window.
- F4 was adjudicated `won't-fix` pending real-Mac evidence. This QA is the evidence required to reopen it.

Sources:

- [Issue #15](https://github.com/mygirleatsmayo/lil-chromium/issues/15)
- [Issue #21](https://github.com/mygirleatsmayo/lil-chromium/issues/21)
- [Integrated QA #26](https://github.com/mygirleatsmayo/lil-chromium/issues/26)
- `~/projects/lil-chromium/docs/research/r01-chromium-macos-focus-session-restore.md`
- `~/projects/lil-chromium/docs/scratch/lil-chromium-focus-bug-hunches.md`
- `lil-chromium-v0.4/.mayosdd/tickets/evidence/issue-21-wake-transition/REVIEW-CHROME-EXTENSION.md`, F4
- `lil-chromium-v0.4/.mayosdd/tickets/evidence/issue-21-wake-transition/ledger.md`, F4 adjudication

## Research findings and limits

- Chromium's public focus API is intended to expose a key window, but the exact Helium/macOS background-window behavior observed here is not yet captured by an agent-runnable loop.
- Chromium focused-window creation activates the browser application before the new popup becomes key; this is a credible mechanism for cross-display sibling raising.
- Public macOS activation can report success without guaranteeing the desired visible ordering, so native restore success must be checked against the resulting frontmost application.
- Chromium session restoration does not explain the wake relocation: extension-created app popups are generally excluded, and the failure occurs in the live `tabs.create` wake path.
- The prior hunches were written against the correct v0.4 implementation despite stale version labels. Treat them as hypotheses, not diagnoses.

## Required diagnosis discipline

Each bug issue must begin in a fresh context with `mayosdd-diagnosing-bugs`:

1. Build and run one fast, deterministic, agent-runnable command that can report the user's exact symptom red or green. A structured HITL driver is the last resort, not an informal checklist.
2. Reproduce and minimize before ranking hypotheses.
3. Instrument only boundaries that distinguish those hypotheses.
4. Turn the minimized reproduction into the correct regression seam before fixing.
5. Remove temporary instrumentation and rerun the original live loop before completion.

Useful focus trace boundaries, if the loop proves they are needed:

- Native frontmost PID and bundle ID before the open request.
- App-supplied external context received by the extension.
- Every Chromium window's ID, type, and `focused` value before creation.
- Chosen and persisted prior context.
- Focus events through create, user app switching, lil refocus, and close.
- Close-time `wasFocused` and chosen restoration target.
- Host receipt, activation result, and actual frontmost application afterward.

Useful wake trace boundaries, if needed:

- Nap sender window ID and registry entry.
- Requested preload window ID.
- Returned fresh tab ID and window ID.
- Nap-tab removal and resulting window-removal events.
