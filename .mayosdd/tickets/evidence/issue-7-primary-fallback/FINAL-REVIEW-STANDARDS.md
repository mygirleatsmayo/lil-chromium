# Final standards review — issue #7 (`ea58b515...d707f9a6`)

Axis only: documented repo standards + Fowler ch.3 baseline (judgement) + `/swiftui-pro` + `/swift-testing-pro`. Not spec.

**Verdict:** no new findings. No hard documented-standard breach. No baseline smell worth filing. No ledger regression.

## Method

Read `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `docs/PROTOCOL.md`, and the frozen ledger (interpretations 1–4). Walked `git diff ea58b515...d707f9a6` in the review target (`ddb6247`, `99e5979`, `ac5daa1`, `d707f9a`). Applied `/swiftui-pro` (accessibility, views, data, api, design, hygiene, swift, performance, navigation) to the Settings hunks. Applied `/swift-testing-pro` (core-rules, writing-better-tests, async-tests, new-features) to the Swift Testing hunks. Did not modify the review target or re-run tests.

## Documented standards — no hard breaches

1. **AGENTS.md — three-component contract.** PROTOCOL schema v3 `primaryBrowser`, socket order, `get-context` fields, Settings exclusion of Primary, legacy-key preserve / no version downgrade; `mac/` (config, merge, messages, host, routing, Settings); `extension/` (SW normalize, overlay dest/labels, manifest). Pinned IDs untouched.
2. **AGENTS.md — `@MainActor` / `verified:`.** No new AppKit type. `SettingsWindowController` / `SettingsStore` stay `@MainActor`. No new OS claim; existing `verified:` comments untouched.
3. **AGENTS.md — tests / prose.** Decode, merge, routing, catalog, and context wire covered. Shared `fixtures/`. README / CHANGELOG not overwritten.
4. **CONTEXT.md.** Edited user-facing copy says Primary / Fallback. Overlay dest is `"primary"` on caret, hoverbar, and ⌘O.
5. **PROTOCOL.md / ADR-0002.** Launch candidates key off installation slugs via `BrowserTable`, not stale `knownBrowsers.bundleId` rows.

## Ledger (not re-filed)

- **S1** resolved — no `promote("default")` in `overlay.js`.
- **S2** resolved — new Fallback warning keeps `.help` and adds `.accessibilityLabel`. Primary warning stays unlabeled (interpretation 3).
- Interpretations 1–2 hold. Issue #27 not adjudicated (interpretation 4).

## Baseline smells

None filed.

Suppressed: Swift vs JS `primaryBrowser || defaultBrowser` — required PROTOCOL dual decode. `String` slugs — catalog. Twin Settings warning `HStack`s — parallel UI, not a helper the spec asked for. `Binding(get:set:)` retarget — load-bearing `didSet` save. `background.js` `msg.dest || "default"` and command `promoteTab(..., "default")` — unedited catch-all; interpretation 1 limits vocabulary to this diff’s edited action paths. GCD in `OpenRouter.open` — not this hunk. `ObservableObject` / multi-type `SettingsWindow.swift` — pre-existing.

Swift Testing: structs, `#expect` / `#require`, `== false` not `!`, no XCTest.

## needs adjudication

None.
