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
- S7 · tuple unpack of `ActivatedApp` · **fix** · gone with the `target` extraction.

## Spec

- P1 · palette close scenario (QA addendum) not covered by loop scenarios or deterministic tests · **partial fix** · Mechanism covered deterministically: accessory apps never enter the activation history (`anAccessoryAppActivatingOverTheUsersAppIsPassedOver`); a palette-launched lil's creation-time prior context is the pre-palette app's pid (existing open-fixture tests). A real-Mac loop scenario for the palette is a harness change (`scripts/focus-loop`) and is left to Lucas's manual QA of the live build; settled: not required for #31 to close.
- P2 · OpenRouter.swift comments say "predecessor" · **fix** · reworded to glossary terms.
- P3 · no `.mayosdd/tickets/evidence/issue-31-*` directory · **fix** · this ledger creates it; the live-run trace and verdict land here too.
- P4 (c1) · teardown reading is opt-in per removal site instead of `info.isWindowClosing` · **won't-fix now; needs live evidence** · `isWindowClosing` mirrors `TabStripModel::closing_all()`, which is not set on every close path (close-tab on a single-tab window); reading focus at every `tabs.onRemoved` does not depend on it. Stale entries only arise for normal windows (spawned-tab removal) and are overwritten by that window's own teardown reading before use. The `tab-removed` trace event now records `isWindowClosing` per removal; if the live loop shows it true for every close path, simplify in a follow-up.
- P5 (c2) · `focusedWindowId` never seeded, so a respawned worker fabricates an external-app context · **fix** · seeded from `windows.getLastFocused` when it reports `focused:true` and no focus event has arrived; harness gains `options.windows` to boot with pre-existing windows; test "a worker that wakes with a normal window focused reads it as the context the user came from".
- P6 (c3) · `.launchServicesRequested` returned before `openApplication` completes, so `frontmost-after` may sample early · **won't-fix** · The completion handler logs its own LILFOCUS line; the 350 ms settle read is a second sample, and the two together are what the live run needs. Revisit only if the trace shows the request completing later than the settle read.
- AC1 / AC9 (live half) · `#30 command` red-before / green-after · **pending live run** · Lucas runs `node scripts/focus-loop.mjs run --scenarios close/` from this worktree after `make install` and extension reload.
