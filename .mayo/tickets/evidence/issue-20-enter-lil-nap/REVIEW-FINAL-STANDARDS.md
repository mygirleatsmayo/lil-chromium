# Final Standards — issue #20 (enter Lil Nap)

Refs: `3c36c9a`…`b1eb5c4` (= HEAD). Diff non-empty. Settled S1–S3 / P1–P3 unchanged; no `needs adjudication`.

## Hard breaches (documented standards)

None.

Checked: `AGENTS.md` (protocol+extension+Settings landed together; no AppKit isolation or `verified:` drift in the Swift hunk; internal `sleep*` keys/IDs/filenames kept). `CONTEXT.md` Lil Nap (user-facing actions “Let This Lil Nap” / “Wake This Lil”; avoid Sleep / sleeping lil on menus, Settings, overlay, nap page). `docs/PROTOCOL.md` replacement-only release, rollback, named nap-page inputs, restore tint.

## Ledger (reference only)

S1/S3 remain the replacement-or-rollback path and `{ captureKey, originalUrl, originalTitle, tint }` object. S2 remains nap copy with legacy wire/config names.

## Smell judgements

None worth acting on. Duplicate parked-lil fixtures in two restore tests are test repetition, not a production clump. `sleepLil` / `sleep.html` / `slept` stay per S2.

## SwiftUI (`/swiftui-pro` — `SettingsWindow.swift` copy only)

views / accessibility / design / hygiene: no deprecated API, data-flow, or VoiceOver issues in the changed strings. Placeholder still names the whitelist field. `.foregroundStyle(.secondary)` unchanged. No `onTapGesture`. Bindings and icon-only minus control are pre-existing, outside this hunk.

## Outcome

No new findings. No severity-ranked defects.
