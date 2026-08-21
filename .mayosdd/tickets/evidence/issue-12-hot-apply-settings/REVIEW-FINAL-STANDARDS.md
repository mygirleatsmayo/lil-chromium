# Final Standards review — issue #12

Axis: documented repo standards (`AGENTS.md`, `CONTEXT.md`, `docs/PROTOCOL.md`) + Fowler ch.3 baseline (judgement) + `/swiftui-pro` + `/swift-testing-pro` on SwiftUI / Swift Testing hunks only. Not a spec review. Evidence Markdown is audit context.

Refs resolved: `3c36c9a97d94e5ac9211b81c94e3ec72e226a558` → HEAD `d0262a51d7b7bd71046790c5df9289de79e1decc`. Diff non-empty (`git diff 3c36c9a…HEAD`: 24 files, +940/−50). Commits: `9423784` feat, `26a9ecd` review docs, `3caaf61` remediation, `d0262a5` remediation review.

Ledger frozen. S1–S3 remain **resolved**; no reinterpretation.

## Hard — documented standards

None.

- **AGENTS.md:** Protocol/message/`config.json`/socket/slug changes land in app, host, extension, and `docs/PROTOCOL.md`. `SettingsStore` / window controller stay `@MainActor`. No new AppKit type without that annotation. No `verified:` drift. Shared `fixtures/`. Lucas-facing prose not overwritten.
- **CONTEXT.md:** PROTOCOL Settings singleton uses “live relays” and “lils”. Settings UI says “Reveal zone”. Avoided synonym “connected browser” is gone from production/protocol hunks.
- **PROTOCOL.md:** `config-update` shape, clamp-at-model, fanout, reconnect catch-up, and overlay live-read match the three components.

## Judgement — baseline smells

None new. Cross-file `revealHeight` / `config-update` edits are required lockstep, not Shotgun Surgery. `Int` px + `HoverBarConfig` clamp is not Primitive Obsession. Host’s explicit `config-update` forward is contract documentation, not a Middle Man. `ContextPayload` is the single mapping (ledger S2).

## SwiftUI (`/swiftui-pro`, `SettingsWindow.swift` only)

No new findings. Slider sits in `LabeledContent`; `.foregroundStyle(.secondary)`; `.accessibilityValue("… px")`; no rigid caption width (ledger S3). `Binding(get:set:)` not filed: nested `LilConfig` already binds that way; Slider needs `Double`, model is `Int`. Visible `N px` `Text` left as an accessibility sibling because S3 forbids a layout redesign.

## Swift Testing (`/swift-testing-pro`)

No findings. `ConfigTests` / `MessageTests` / `RoutingTests` additions are structs, `#expect` / `#require`, `== false` not `!`, no XCTest, isolated fixture decode, no shared mutable state. Multiple expects in `contextAndConfigUpdateShareBrowserNormalization` cover one shared-normalization behavior.

## Outcome

No hard breaches, no genuine baseline smells, no skill findings, no `needs adjudication`. Ready on the Standards axis.
