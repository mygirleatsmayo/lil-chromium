# Standards review — Issue #7 (Primary / Fallback)

Axis: documented repo standards + Fowler ch.3 + `/swiftui-pro` + `/swift-testing-pro`. Read-only diff `ea58b515…ddb62474` (1 commit, 23 files) against `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `docs/PROTOCOL.md`, ADR-0002.

## Documented standards — hard

**S1 — CONTEXT.md — Avoid “Default browser” for Primary (medium).** `extension/overlay.js`: this diff renamed the caret-menu dest to `"primary"` but left the hover-bar button and ⌘O on `"default"`. That token is the avoided name for the Primary promote action. `background.js` `promoteTab` treats any non-group/host-tab/browser dest as promote-to-Primary, so behavior still works; a later `dest === "primary"` special case would break ⌘O.

```
addItem(menu, "Open in " + primaryName, "⌘O", () => promote("primary"));
promoteBtn.addEventListener("click", () => promote("default"));
promote("default");  // ⌘O
```

## Documented standards — checked, not filed

1. **AGENTS.md — three-component contract.** `docs/PROTOCOL.md`, `mac/` (config, merge, messages, host, routing), and `extension/` (SW context, overlay labels, manifest) all move together. Pinned IDs untouched.
2. **AGENTS.md — `@MainActor` / `verified:`.** No new AppKit type. `SettingsWindowController` / `SettingsStore` stay `@MainActor`. No new OS claim; existing `verified:` comments untouched.
3. **AGENTS.md — tests / prose.** Swift and extension tests cover decode, merge, routing, and context wire. README / CHANGELOG / Lucas copy not overwritten. PROTOCOL edits are the required contract update.
4. **PROTOCOL.md.** Schema v3 `primaryBrowser`, routing sockets, `get-context` fields, Settings excluding Primary while keeping sibling channels, legacy-key read + merge preserve, no version downgrade — match the Swift/JS implementations.
5. **ADR-0002.** Launch candidates key off installation slugs via `BrowserTable`, not stale `knownBrowsers.bundleId` rows.

## `/swiftui-pro` / `/swift-testing-pro`

**S2 — Accessibility (low).** New Fallback warning is an icon-only `Image` with `.help`, no `accessibilityLabel`. VoiceOver does not get the help string. Copied from the existing Primary picker (that one is pre-existing; this hunk is new).

```
Image(systemName: "exclamationmark.triangle.fill")
    .foregroundStyle(.yellow)
    .help("Choose an installed browser other than Primary.")
```

Swift Testing: structs, `#expect` / `#require`, `== false` not `!`, no XCTest. No findings.

Suppressed: `Binding(get:set:)` retarget only (didSet save is load-bearing); `ObservableObject` / multi-type `SettingsWindow.swift` pre-existing; GCD in `OpenRouter` not in this hunk.

## Baseline smells (judgement only)

Repo standards override the baseline. S1 is also **Shotgun Surgery leftover** in a file this diff already edited — not a second finding.

Suppressed: Swift vs JS `primaryBrowser || defaultBrowser` fallback — required dual implementation of PROTOCOL, covered on both suites. `String` slugs — PROTOCOL catalog. Two Settings warning `HStack`s — parallel UI, not a helper the spec asked for.
