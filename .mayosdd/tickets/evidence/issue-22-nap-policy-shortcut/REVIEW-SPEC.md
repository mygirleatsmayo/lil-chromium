# Spec review — issue #22 (Preserve Lil Nap policy and expose an optional shortcut)

Fixed `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` → head `85491720bfcf14823256b5937b600f3f7d21f1b4` (`git diff …...HEAD` non-empty; one commit). Sources: `gh issue view` 22 / 2 / 20 (no comments), issue-5 and issue-20 ledgers, `CONTEXT.md`, `docs/PROTOCOL.md`. Production/tests not executed or edited.

## 1. Missing or partial

None.

## 2. Behaviour not requested

None in production. Diff is `let-this-lil-nap` (no `suggested_key`), `commands.onCommand` → existing `sleepLil`, protocol lockstep for that command plus already-true manual-while-auto-off / shared capture throttle, and MV3 tests/harness journal `at`. Wake (#21) and icon work are untouched.

## 3. Implemented but wrong

None.

## Checked

**Auto + threshold.** Issue #22: “Automatic Lil Nap runs only when globally enabled and the configured idle threshold has passed.” Parent #2 §48; PROTOCOL: auto is `sleep.enabled`, “idle > `afterMinutes`”, same sweep. Sweep still `continue`s when `!ctx.sleep.enabled` or `idleMs <= afterMinutes * 60 * 1000`. Tests: disabled-after-idle; 44 min hold then 46 min nap.

**Guards.** Issue #22 / parent §48 / PROTOCOL: skip focused, audible, dirty-form, whitelist, incognito “according to their configured guards”; audio/form/whitelist are auto-only. Sweep: focused via `getLastFocused`; `audioGuard && audible`; `formGuard && dirtyTabs`; `hostWhitelisted`; `incognitoLils`. Independent skip tests clear sibling guards. Incognito never captured: issue #20 AC; parent §§32/45; PROTOCOL “Incognito lils are never captured or napped”; issue-20 ledger (incognito exclusion passed). `sleepLil` still returns false for incognito (manual included).

**Manual while auto off.** Issue #22 / parent story 81 / §48; PROTOCOL: “Manual entry stays available while `sleep.enabled` is false.” `sleepLil` does not read `enabled`. Tests: `sleepThisLil` and the command with `enabled: false`; auto-only guards ignored; incognito still refused (privacy).

**Shortcut.** Issue #22 / parent story 82 / §§26/49; PROTOCOL: unassigned `let-this-lil-nap` (“Let This Lil Nap”); ⌘L/⌘O not remappable commands; `promote-tab` keeps `Command+Shift+O` / `Ctrl+Shift+O`. Manifest has description only; command test asserts that plus overlay ⌘L/⌘O.

**Capture bound.** Issue #22 / parent testing 9; PROTOCOL: `captureVisibleTab` “throttled ≤2/sec, sequential via the shared `throttledCapture` path”. Unchanged `CAPTURE_MIN_GAP_MS = 550` chain; concurrent `sleepThisLil` test asserts ≥500 ms.

**Oracle / Drowzy.** Issue #22 last AC; parent testing 10–11; issue-20 ledger (oracle distinction passed). Node suite has no Memory Saver/Drowzy; existing discard/freeze test still uses public `discarded`/`frozen` without naming an actor (comments only).

Issue-5 unfocused-restore and `type: "popup"` settlements are out of this diff. `CONTEXT.md` Lil Nap labels match the command description.
