# Differential diagnosis — v0.3 to v0.4 focus and Lil Nap regressions

## Provenance

- Surfx task: `e_dNQ7mm`
- Worker: Claude Opus 5, xhigh effort
- Mode: read-only diagnosis using `mayosdd-diagnosing-bugs`, `chrome-extension`, and `swift-testing-pro:swift-testing-pro`
- v0.3 comparison point: `d0a858ec82a0aa7a418904ac64941790b9bd9b24`
- v0.4 comparison point: `f38dd4439e9f0feb8d78a46221628a588631e0b9`
- Live trace: `trace-2026-08-26T22-01-38-768Z.jsonl`
- Live verdict: `verdict-2026-08-26T22-01-38-768Z.json`

The comparison points are immutable commits with different Git tree objects. The directory historically named `lil-chromium-v0.3` was running v0.4 during the live trial, but the worker did not use that directory name as version evidence. It compared the two exact commit objects. It did not run v0.3 behaviorally.

## Opus conclusion

### Prior-comparison verdict

No prior real v0.3-to-v0.4 comparison had occurred. Issues #26, #30, #31, #32, and #33 had no comments recording one. The existing evidence contained Lucas's recollection that v0.3 behaved better, while explicitly saying a differential loop still needed to pin Helium and vary extension code. The only live structured run was v0.4 at `f38dd44`, extension version `0.4.0-trial`.

### What changed across the 202 commits

1. **Prior-context capture and restoration:** `a236e3a` (Issue #15) deleted v0.3's `mruStack`/`mruTouch`/`mruTopAlive` behavior. It added typed capture-time prior contexts, `focusedWindowId`, `lastNormalWindowId`, protocol messages, native external-app capture, and `ExternalAppRestorer`. `54d81f9` added a promotion guard.
2. **Lil creation:** `48186e6` centralized creation through `openLil`. The literal create/focus calls remain `windows.create({type: "popup", focused: true})` followed by `windows.update({focused: true})`; `clampBounds` is unchanged.
3. **Lil Nap wake:** `1b2673b` (Issue #21) replaced v0.3's in-place `tabs.update(napTab, {url})` with v0.4's create/swap/remove transition: create an inactive fresh tab in the lil, activate it, then remove the nap tab. Commits `2f737e3` and `5beebdb` added Issue #33 hardening.
4. Both versions keep the native app at `.accessory` activation policy. Neither relay-open path contains an `NSWorkspace` activation call.

### Ranked hypotheses

#### H1 — Confirmed: v0.4 close restoration is gated off in the live event order

`wasFocused = focusedWindowId === windowId` is evaluated on removal after Chromium has already handed key status to a sibling window. In a repetition where the operator genuinely focused the lil, the trace records focus moving to the normal window before `window-removed` fires.

Across the 441-record trace:

- 26 of 26 `window-removed` events have `wasFocused:false`.
- There are zero `restore-attempt` events.
- There are zero host `restore-focus` lines.

The intended restoration code therefore never executes in this live run. The Node Chrome harness missed the real ordering because its window removal emits only `onRemoved`, without the preceding `onFocusChanged` that Chromium produces on macOS.

#### H2 — Unresolved: v0.4 opening regression

The trace shows a cross-display key-transfer sequence while the lil remains open: the lil is created, receives focus, and a sibling Helium window rises milliseconds later. Same-display green cases lack the same visible sibling rise. Chromium's focused-show activation path is a credible mechanism for the visible sequence.

However, the unchanged literal create/focus calls do not prove that Lil Chromium did not regress. Issue #5 centralized every create/adopt/restore path, Issue #15 changed lifecycle focus state, and Issues #16/#18 added further shared-lifecycle routes. Issue #32 explicitly requires a same-Helium-version differential or equivalent trace before application activation can be treated as the diagnosis.

No actual v0.3 runtime was exercised. The hypothesis that Helium or platform behavior alone caused the regression is not established.

#### H3 — Strong code differential: Lil Nap wake regression

The relocation/closure symptom matches the wake algorithm introduced by `1b2673b`: if Chromium returns the preload tab in another window, removing the original nap tab empties and closes the lil while the URL survives elsewhere. `f38dd44` includes later relocation guards, but their behavior remains unverified on the real Mac.

#### H4 — Falsified for this live run: stale focused-window capture

The scratch hunch that a stale Chromium `focused:true` value overrides the correct external app does not match this trace. All 26 prior-context capture records show the normal Helium window as `focused:false` and choose Mail's external-app PID/bundle context. Capture is correct in this run; restoration never begins.

#### H5 — Low probability: native main-menu activation

v0.4 added `MainMenu.swift`, but the app remains `.accessory`, and neither version activates an app in the relay open path.

### Minimum remaining differential

The existing Issue #30 loop cannot run against unmodified v0.3 because v0.3 lacks `focus-trace.js` and the current preflight requires an extension trace record. A valid comparison must pin the same Helium build, browser profile, display topology, and Primary placement, then vary only the extension code. It can either backport only behavior-neutral trace instrumentation to v0.3 or score the version-independent native focus probe without requiring extension trace events.

The close gate can be tested first in v0.4 by tracing what `restorePriorContext` would do without the `wasFocused` guard. That distinguishes “restoration never requested” from “native activation requested but ineffective.” This is diagnosis only, not approval to remove the guard as a fix.

### Unknowns

- Whether actual v0.3 raises a sibling cross-display under the same Helium build and topology.
- Whether `NSRunningApplication.activate(from:)` from the faceless host visibly restores the intended external app on this macOS; H1 prevents the current trace from exercising it.
- Whether Issue #33's wake hardening keeps the URL inside the lil in live Helium.
- The Helium build used during Lucas's historical v0.3 use.

## Manager adjudication

1. **Issue #31:** H1 is durable, live evidence that the restoration branch does not execute. Issue #15's creation-time predecessor model is separately rejected by Issue #31 and ADR-0004; repairing only the dead gate must not preserve the superseded state model.
2. **Issue #32:** H2 is a mechanism hypothesis, not a root-cause diagnosis. The next diagnosis must examine v0.4 lifecycle and focus-state changes and satisfy the ticket's same-Helium-version requirement. A Helium-specific patch is not a valid product direction because Lil Chromium supports arbitrary compatible Chromium browsers.
3. **Issue #33:** The code differential identifies the regression-bearing transition. The existing hardening still requires the ticket's original live loop to pass before closure.
4. External prior-art research may describe platform limits, but it does not supersede this regression evidence or justify skipping the v0.3-to-v0.4 differential.
