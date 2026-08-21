# Spec review — issue #15 (prior context)

Range `ea58b515…a236e3a2`. Contract: issue `#15`; parent `#2` stories 56–58, decisions 34–37, testing 7; issue `#5` ledger 1–4; `CONTEXT.md` **Prior context**; `docs/PROTOCOL.md` promote + v4 focus text in this diff.

## Findings by severity

### High — (b) unrequested, (c) wrong vs promote

> unwind that per-lil chain on close without raising incidental browser windows.

> **Promote semantics**: if `defaultBrowser == ` the browser the lil lives in → v1 no-reload move (`tabs.move` → `windows.create({tabId})` fallback)

`onRemoved` restores when `wasLil && focusedWindowId === windowId`, before deregister. `moveTabIntoHostBrowser` still moves the last tab out, then focuses the host. That empty popup is removed during the move while the lil is registered and still the focused id, so restore runs on promote.

Deleted `mruRemove` has no replacement. ⌘O / host-tab can `restore-focus` Mail or a stored normal window that is not the promote target. The host-tab test does not forbid `restore-focus`. Handoff-to-another-browser deregisters first and is fine.

### Medium — (a) partial tests

> If the recorded external process quit, bundle fallback may activate the same app; if no eligible app exists, no incidental browser window is focused.

> Cover … **external app quitting**, …

`ExternalAppRestorer` does PID, then bundle, then no-op. No native test of that type; no MV3 test with a dead PID. AC 10’s “native tests [and] MV3 tests … agree on these invariants” misses this bullet.

## (a) Missing or partial

Only the Medium item. Nested unwind, related normal window, stale lil, post-create MRU activity, cascade naming the source, close-once-before-cleanup, unfocused restore (`focus: false`, ledger 1), WINDOW_ID_NONE skip-restore, popup-not-normal, restart remap, incognito in-memory predecessor, Accessibility/no z-order, fixtures, and protocol lockstep are present.

## (b) Unrequested

The High promote restore. Popup exclusion and startup remap fit the ticket.

## (c) Implemented but wrong

The High promote path. Capture-before-create and typed predecessors match decisions 34–35.

## Checked, no defect

Ledger 1–4 (unfocused restore, dual URL guard, `type: "popup"`, `prev` merge). Resize/registry never pass `focused`. Close uses `WINDOW_ID_NONE`. `CONTEXT.md` omits related normal windows; `#15`/`#2` require them — code follows the ticket.
