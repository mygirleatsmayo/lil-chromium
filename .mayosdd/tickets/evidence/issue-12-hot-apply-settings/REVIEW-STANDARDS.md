# Standards review — issue #12 (hot-apply settings)

Axis: documented repo standards + Fowler ch.3 baseline (judgement) + `/swiftui-pro` + `/swift-testing-pro`. Not a spec review.

Refs: `3c36c9a97d94e5ac9211b81c94e3ec72e226a558` → HEAD `9423784f1c4a666dd68618f9e894de5b43b9f4e5` (brief SHA `09423784…` does not resolve; extra leading `0`). Diff non-empty: PROTOCOL, `mac/` app/host/shared + tests, `extension/` worker/overlay + tests, `fixtures/`.

## Hard — documented standards

**H1 (low)** — `docs/PROTOCOL.md` Settings singleton (new hot-apply sentence). **Rule:** `CONTEXT.md` Host browser / Primary browser — avoid “connected browser”.

```
so all connected browsers and lils converge without waiting for a reconnect
```

That phrase is the avoided synonym, not “live relays” / “host browsers”. Settings UI copy correctly uses “Reveal zone”.

No other hard breaches: three-component lockstep holds; `SettingsStore` / `SettingsWindowController` stay `@MainActor`; no new AppKit type; no `verified:` drift; shared fixtures; no Lucas README/CHANGELOG overwrite.

## Judgement — baseline smells

**J1 (medium, Duplicated Code)** — `ContextPayload` is documented as the one mapping for `context` and `config-update`, but the host still inlines the same browsers + display-name logic.

```
public enum ContextPayload {
    public static func browsers(from config: LilConfig) -> [ContextBrowser] { ... }
    public static func displayName(forSlug slug: String, in config: LilConfig) -> String { ... }
}
```

```
func displayName(forSlug slug: String) -> String { ... cfg.knownBrowsers ... }
if cfg.knownBrowsers.isEmpty { known = BrowserTable.all.map { ... } }
else { known = cfg.knownBrowsers.map { ... } }
```

A later normalization change can desync reconnect `context` from Settings `config-update`.

## SwiftUI (`/swiftui-pro`)

**S1 (low, accessibility)** — `SettingsWindow.swift` reveal-zone slider. `LabeledContent("Reveal zone")` is sound; `.frame(width: 44)` on the `px` caption fights Dynamic Type (`references/accessibility.md`). Slider has no `accessibilityValue` for “N px”.

`Binding(get:set:)` not filed: this file already binds nested `LilConfig` that way, and Slider needs `Double` while the model is `Int`.

## Swift Testing (`/swift-testing-pro`)

No findings. New tests are structs with `#expect` / `#require`, `== false` not `!`, no XCTest, isolated, no shared mutable state.

## Checked, not filed

`revealHeight` + `config-update` edits across app/host/extension/PROTOCOL/fixtures are required lockstep, not Shotgun Surgery. Slider persist-per-step matches PROTOCOL “every Settings write”. Host’s explicit `config-update` case vs `default` forward is contract documentation, not a Middle Man. `Int` px + clamp on `HoverBarConfig` is not Primitive Obsession.
