# Issue #31 — code-review ledger (2026-09-17)

Two-axis review (mayosdd-code-review) of branch `v0.4/issue-31-focus-history`.
Fixed point: `ffddb3c` (main). Pre-fix point (HEAD the full review saw): `0850be9`.
Reviewers: two Claude Code sub-agents (Opus), Standards and Spec axes.

One line per finding: `ID · location · verdict · settled interpretation`.

## Standards

- S1 · `verified:` markers missing on live-trace claims (background.js teardown comment; test/chrome.js teardown comment; ActivationHistory accessory-app doc) · **fix** · Marker covers only what the 2026-08-26 trace showed: handoff `focus-changed` before `window-removed` (26/26). "Tabs removed before the window" is Chromium ordering not yet traced; the new `tab-removed` LILFOCUS event verifies it on the next live run. The accessory-app sentence is reworded as policy, not an OS claim.
- S2 · `Relay` builds main-actor state via `MainActor.assumeIsolated` in `init` (host main.swift) · **fix** · The history is created at the entry point (main thread) and handed to `Relay(browserSlug:activationHistory:)`; `Relay` no longer imports AppKit. `Relay` itself stays non-isolated by design: it is the multi-threaded relay (socket and native-messaging threads with locks).
- S3 · restorer target precedence and history policy untested · **fix** · `ExternalAppRestorer.target(pid:bundleId:history:)` extracted and tested (recorded pid wins; history decides when none; nothing without either). `ActivationHistory.note(_:policy:)` takes the activation policy so the regular-only rule is tested at the model seam. Seeding from the frontmost app stays untested (one NSWorkspace read).
- S4 · duplicated `focusOrder` splice in test/chrome.js · **fix** · `forgetFocus(id)` helper.
- S5 · Data Clumps: window-keyed sets + `lastTransfer`; three deletes in `onRemoved` · **won't-fix** · Each set has one meaning and one consumer; a per-window record would couple teardown, explicit-focus, and creation state that change for different reasons. Revisit if a fourth lifecycle mark appears.
- S6 · `focusGainsSeen` name · **fix** · renamed `everFocused`.
- S7 · tuple unpack of `ActivatedApp` · **fix** · gone with the `target` extraction; the residual `let (pid, bundleId) = (target.pid, target.bundleId)` (remediation round 1) is replaced by direct member access.

## Spec

- P1 · palette close scenario (QA addendum) not covered by loop scenarios or deterministic tests · **partial fix** · Mechanism covered deterministically: accessory apps never enter the activation history (`anAccessoryAppActivatingOverTheUsersAppIsPassedOver`); a palette-launched lil's creation-time prior context is the pre-palette app's pid (existing open-fixture tests). A real-Mac loop scenario for the palette is a harness change (`scripts/focus-loop`) and is left to Lucas's manual QA of the live build; settled: not required for #31 to close.
- P2 · OpenRouter.swift comments say "predecessor" · **fix** · reworded to glossary terms.
- P3 · no `.mayosdd/tickets/evidence/issue-31-*` directory · **fix** · this ledger creates it; the live-run trace and verdict land here too.
- P4 (c1) · teardown reading is opt-in per removal site instead of `info.isWindowClosing` · **won't-fix now; needs live evidence** · `isWindowClosing` mirrors `TabStripModel::closing_all()`, which is not set on every close path (close-tab on a single-tab window); reading focus at every `tabs.onRemoved` does not depend on it. Stale entries only arise for normal windows (spawned-tab removal) and are overwritten by that window's own teardown reading before use. The `tab-removed` trace event now records `isWindowClosing` per removal; if the live loop shows it true for every close path, simplify in a follow-up.
- P5 (c2) · `focusedWindowId` never seeded, so a respawned worker fabricates an external-app context · **fix** · seeded from `windows.getLastFocused` when it reports `focused:true` and no focus event has arrived; harness gains `options.windows` to boot with pre-existing windows; test "a worker that wakes with a normal window focused reads it as the context the user came from".
- P6 (c3) · `.launchServicesRequested` returned before `openApplication` completes, so `frontmost-after` may sample early · **won't-fix** · The completion handler logs its own LILFOCUS line; the 350 ms settle read is a second sample, and the two together are what the live run needs. Revisit only if the trace shows the request completing later than the settle read.
- AC1 / AC9 (live half) · `#30 command` red-before / green-after · **pending live run** · Lucas runs `node scripts/focus-loop.mjs run --scenarios close/` from this worktree after `make install` and extension reload.

## Remediation round 1 (pre-fix point `0850be9` → `f44d593`)

All fix-marked findings resolved except the S7 residual above. New in the delta:

- R1 · `lastNormalWindowId` left unseeded on a respawned worker (same root as P5) · **fix** · the seed sets it too when the focused window is normal; test "a worker that wakes with a normal window focused still converts a Command+T tab opened there from a lil".
- R2 · `HostLog.configure` now runs after the activation history is created · **fix** · logging is configured at the entry point, first thing after slug detection; `Relay.init` no longer configures it.
- R3 · top-level isolation comment carries an unmarked toolchain claim · **fix** · `verified:` marker with the toolchain and the compiler diagnostic observed.
- R4 · ledger exists only on the branch, `main` owns `.mayosdd/` · **settled, no action** · this branch merges into `main`; the ledger and the live evidence land there with it, never only on the trial worktree.

## Final full review (fixed point `ffddb3c`, HEAD `50452d9`)

Two axes again; ledger passed along. New findings only.

### Standards

- F1 · `bundleId` accepted without `pid` by the extension normaliser and PROTOCOL, but dropped by the host · **fix** · Contract tightened: `bundleId` accompanies a recorded `pid` and is never sent alone; the normaliser keeps it only with one.
- F2 · glossary drift: test title "a stale predecessor lil" (in the diff); trace outcome string `no-predecessor` (pre-existing, not in the diff) · **fix the title; won't-fix the string** · A trace outcome string is part of the loop's replay vocabulary and outside this change.
- F3 · `AGENTS.md` still says "Swift 6.2 toolchain"; the toolchain is 6.4 · **won't-fix here** · `AGENTS.md` is Lucas's prose on `main`; flagged to Lucas.
- F4 · `for app in eligible where app.activate(...)` hides a system mutation in a predicate clause; `first` names its role poorly · **fix** · explicit `guard … else { continue }` loop; `preferred`.
- F5 · `lastTransfer.written` names a promise of the displaced prior context · **fix** · renamed `displaced`. `setPriorContext` returning the displaced value stays: the revert needs it and the doc comment says so.
- F6 · the promote path focused normal windows around `focusWindow`, contradicting the "tracked per window in `explicitFocus`" comment · **fix** · both sites route through `focusWindow`; the fallback `windows.create({focused:true})` for a brand-new normal window is not a refocus and is left alone.

### Spec

- F7 · in-place removal declaration (`removeTabInPlace`) untested · **fix by deletion** · Settled: a window's last tab is removed before the window itself, so the reading in force at `windows.onRemoved` is always the teardown's own; earlier readings (wake swaps) are overwritten, never consumed. The declaration was dead code. Plan design item 1's "declare themselves" clause is withdrawn; its guarantee ("never read as a teardown") holds by ordering. The `tab-removed` trace keeps `isWindowClosing` and `heldFocus`.
- F8 · AC6 "unfocused red-button close leaves the active app unchanged" untested with the browser frontmost · **fix** · test "closing an unfocused lil by its red button while a sibling lil holds focus restores nothing, even after a wake" — the wake swap makes the stale-reading case real, and the close still restores nothing.
- F9 · ADR-0004 and glossary silent on host-resolved external-app identity · **fix (ADR only)** · one paragraph added to ADR-0004. The glossary entry already states the invariant ("not permanently fixed when the lil is created") without naming a mechanism, which is the glossary's job.
- F10 · restore precedence inverted relative to the plan (recorded pid before history) · **needs adjudication → fix** · Settled per ADR-0004 and the plan: the host's live activation history wins; the recorded pid is the last resort only when the host has no history. A recorded pid before the history is creation-time identity, which the ADR supersedes. Host, tests, and PROTOCOL now say so.

## Remediation round 2 (pre-fix point `50452d9` → `83d5d0d`)

F1–F10 resolved. New in the delta:

- F11 · a history entry for an app that has quit shadows the recorded pid, so nothing is restored · **needs adjudication → fix** · Settled: the history holds only running apps. It is an ordered list in activation order, each app once; a termination notification removes the app and the one the user was in before it takes its place (what macOS itself would reveal). Only an empty history falls back to the recorded pid. Test "aQuitAppFallsOutOfTheHistory".

## Live run (`deaf518`, `make install` from this branch, Helium)

Loop: `node scripts/focus-loop.mjs run --scenarios close/` — all three close scenarios green (`LIVE-RUN-2026-09-17.md`, `trace-2026-09-17T23-20-49-256Z.jsonl`). Lucas's manual checks were not: a lil from a Mail link returned to the primary browser window; a palette lil returned to Mail but raised the primary window above the other apps. Both are in the evidence, both are root causes the loop's frontmost-app verdict does not see.

- L1 · a link clicked in Mail is sent with `appPriorContext=none` (host log `23:23:41Z`, `23:27:46Z`), so the extension records the focused normal window and the close returns to it · **fix** · LaunchServices activates the URL handler before `handleIncomingURL` runs, so `NSWorkspace.frontmostApplication` is Lil Chromium itself at that moment. The app now keeps its own `ActivationHistory` from launch (moved to `LilShared`, exclusion-based; the host excludes its browser, the app excludes nothing) and sends `lastExternal`. Same URL sent from a script (`23:30:08Z`) arrived with Mail frontmost, which is why the scripted loop was green.
- L2 · after a focused close the restored app is frontmost but the primary browser window has risen one step (probe `afterClose` z-order: Mail 0, Helium 1, cmux 2 where `before` had Helium 2) · **fix** · Chromium's key handoff to the sibling fires 27–32 ms after `tab-removed` and before `window-removed`; the restoration was sent 2 ms after the handoff. The extension now restores at `tabs.onRemoved` when `isWindowClosing && heldFocus` (true in 6/6 closes in the trace), while the lil still holds key; `windows.onRemoved` restores only what teardown did not. Trace `restore-attempt` gains `at`. Test "a focused lil restores its prior context before Chromium hands key to a sibling" (red at `deaf518`).
- L3 · extension manifest still `0.4.0` / `0.4.0-trial` on a changed build · **fix** · `0.4.1` / `0.4.1-issue-31`; the app footer already reads `git describe`.
- L4 · "different apps respond differently" (Mail vs Finder vs Obsidian) · **settled, no action** · they were different paths, not different apps: a Mail link goes through LaunchServices (L1); the palette records a pid from the app's own history; the loop sends `open` from a script with Mail frontmost.

## Remediation round 3 (pre-fix point `deaf518` → `68af155`)

L1–L3 resolved. New in the delta:

- N1 · `restoredAtTeardown` was set after an await, so `windows.onRemoved` (~30 ms later live) could restore a second time · **fix** · the teardown takes a promise per window synchronously (`teardownRestores`); `windows.onRemoved` awaits it instead of racing it.
- N2 · the teardown path lacked the promotion guard `windows.onRemoved` has · **fix** · one predicate, `unwindsFocus`, used by both.
- N3 · a two-tab lil (wake swap) restored once per tab · **fix** · same promise, taken once per window; the test now closes a two-tab lil and asserts one restoration.
- N4 · with restoration earlier, a focus event that records nothing (`onFocusChanged(NONE)` as the restored app comes forward, or the refocus of the prior lil) can land between the handoff and `window-removed`, and both discarded the handoff transfer before `revertHandoffFrom` ran · **fix** · a non-recording focus event keeps a transfer whose source is mid-teardown (`endTransferUnlessHandoff`). Pinned by the existing test "each lil restores its recorded prior context from a nested external-app chain", which went red on the promise-based teardown for exactly this ordering.
- N5 · `AGENTS.md` toolchain edit contradicts F3's "won't-fix here" · **settled, no action** · Lucas directed it ("AGENTS.md is stale then update it"); F3's disposition is superseded by that instruction.
- N6 · `_ = OpenRouter.activationHistory` names nothing · **fix** · `OpenRouter.startActivationHistory()`.

## Remediation round 4 (pre-fix point `68af155` → `6e59a8e`)

N1–N4, N6 resolved. New in the delta:

- N7 · `endTransferUnlessHandoff` read "mid-teardown" from `teardownFocus`, which records every tab removal until the window goes, so a transfer out of a normal window where the user had ever closed a tab survived non-recording events and its eventual close reverted a lil's prior context · **fix** · a window is mid-teardown only while Chromium flags its tabs' removal `isWindowClosing` (`closingWindows`, cleared at `windows.onRemoved`); `teardownFocus` keeps its one job (P4). Test "closing a normal window the user once came from does not rewrite a lil's prior context", from the reviewer's reproduction (red at `6e59a8e`).

## Remediation round 5 (pre-fix point `6e59a8e` → `c4002b7`)

N7 resolved; no new defects. Two judgement calls, both settled:

- N8 · `closingWindows` is the fourth window-keyed lifecycle mark S5 named as its revisit trigger · **settled, no action** · folding it into `teardownFocus`'s value would undo N7's one-job rule; the marks stay separate. Revisit only if a fifth appears.
- N9 · a `closingWindows` entry is cleared only by `windows.onRemoved` · **settled, no action** · the same lifecycle every teardown mark relies on; no new leak class.

Ledger fully resolved at `c4002b7`. The final full review before integration runs after Lucas's live verification, so any live finding is in it.
