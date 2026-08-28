# Final Spec review — issue #22

Fixed `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` → head `2e8185ea3cb574c068bc300407340b04558ffcc7` (`git diff …...HEAD` non-empty). Sources: `gh issue view` 22 / 2 / 20 (no comments), issue-5 / issue-20 / issue-22 ledgers, `CONTEXT.md`, `docs/PROTOCOL.md`. Production, tests, and live components not executed or edited.

Issue-22 ledger (final): “Automatic-policy guards, manual entry while automatic Nap is disabled, the unassigned Chromium command, unchanged existing shortcuts, serialized capture, and the requested test/oracle coverage passed both axes. No remediation is owed.” No new Spec defects vs that settlement.

## 1. Missing or partial

None.

## 2. Behaviour not requested

None in production. Diff is `let-this-lil-nap` (no `suggested_key`), `commands.onCommand` → existing `sleepLil`, protocol lockstep, harness `command` + journal `at`, and MV3 policy/command/concurrency tests. Wake (#21) and icons untouched.

## 3. Implemented but wrong

None.

## Checked

**Auto + threshold.** Issue #22: “Automatic Lil Nap runs only when globally enabled and the configured idle threshold has passed.” Parent #2 §48; PROTOCOL: auto is `sleep.enabled`, “idle > `afterMinutes`”, same sweep. Sweep still `continue`s when `!ctx.sleep.enabled` or `idleMs <= afterMinutes * 60 * 1000`. Tests: disabled-after-idle; 44 min hold then 46 min nap.

**Guards.** Issue #22 / parent story 80 / §48 / PROTOCOL: skip focused, audible, dirty-form, whitelist, incognito “according to their configured guards”; audio/form/whitelist auto-only. Sweep: focused via `getLastFocused`; `audioGuard && audible`; `formGuard && dirtyTabs`; `hostWhitelisted`; `incognitoLils`. Independent skip tests clear sibling guards. Incognito never captured: issue #20 AC; parent §§32/45; PROTOCOL “Incognito lils are never captured or napped”; issue-20 ledger. `sleepLil` still returns false for incognito (manual included).

**Manual while auto off.** Issue #22 / parent story 81 / §48; PROTOCOL: “Manual entry stays available while `sleep.enabled` is false.” `sleepLil` does not read `enabled`. Tests: `sleepThisLil` and the command with `enabled: false`; auto-only guards ignored; incognito still refused (privacy).

**Shortcut.** Issue #22 / parent stories 40–41, 82 / §§26/49; PROTOCOL: unassigned `let-this-lil-nap` (“Let This Lil Nap”); ⌘L/⌘O not remappable commands; `promote-tab` keeps `Command+Shift+O` / `Ctrl+Shift+O`. Manifest description only; command test asserts that plus overlay ⌘L/⌘O. `CONTEXT.md` Lil Nap actions match the command description.

**Capture bound.** Issue #22 / parent testing 9; PROTOCOL: `captureVisibleTab` “throttled ≤2/sec, sequential via the shared `throttledCapture` path”. Unchanged `CAPTURE_MIN_GAP_MS = 550` chain; concurrent `sleepThisLil` asserts ≥500 ms.

**Oracle / Drowzy.** Issue #22 last AC; parent testing 10–11; issue-20 ledger (oracle distinction passed); issue-22 ledger (test/oracle coverage passed). Node suite has no Memory Saver/Drowzy; discard/freeze test still uses public `discarded`/`frozen` without naming an actor.

Issue-5 unfocused-restore and `type: "popup"` settlements are out of this diff. Protocol lockstep (parent §51) is extension + `docs/PROTOCOL.md` only; no new app/host message.
