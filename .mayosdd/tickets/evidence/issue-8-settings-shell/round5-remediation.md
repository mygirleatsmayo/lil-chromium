# Remediation round 2 — Issue #8

| ID | Status | Change | Verification |
|---|---|---|---|
| F1 | resolved | One `SettingsPaneSize.size` (440×520) is now the NSWindow `contentRect`, `setContentSize` after attaching `NSHostingController`, and `SettingsRoot`'s `.frame`. The leftover 460×560 `contentRect` is gone. First-placement still uses `window.frame.size`, now taken after that size is applied. | Read the code path in `SettingsWindow.swift`. Did not open a window, so the 20% top-edge result was not observed. |

No ledger row required changes outside the ledger's scope; nothing is marked `needs adjudication`. Settled rows and interpretations were not reopened.

## Build

`make app` succeeded (exit 0): `swift build -c release` — "Build complete! (7.96 sec)", bundle assembled at `mac/build/LilChromium.app`, ad-hoc codesigned, registered with Launch Services. No tests exist on this branch; none added.

## Commit

`fbfcdee325911aa4940641a7708232bf30bd2186` — `fix(app): use one Settings pane size for first placement (#8)` on branch `surfx/remediation-round-2-issue-8-fix-the-rows-CSzoU635`. Not pushed; no PR; issue left open. `CONTEXT.md`, `docs/adr/`, `docs/PROTOCOL.md`, and the ledger were not changed.
