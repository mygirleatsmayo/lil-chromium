# Standards review — Issue #11

No findings.

`git diff main...HEAD` against `AGENTS.md`, `docs/PROTOCOL.md`, `CONTEXT.md`, `docs/adr/`, `docs/agents/domain.md`, Fowler ch. 3, and swiftui-pro (genuine risks only).

## Settled (not filed)

Lil Nap has no “no tint”; graphite is the neutral chip. Hoverbar keeps “no tint” and omits the key. One `TintEditor` + `offersNoTint`. `extension/` and `docs/PROTOCOL.md` untouched is correct (no contract change).

## `sleep.tint` writes

Every persist path is `sleepTintIfChanged` → `sleepStorage` → `store.config.sleep.tint`. Reachable new values:

- nil/empty commit → `#8e8e93` (graphite)
- preset / completed custom → `#rrggbb` via `TintHex.normalize`

All are `"gray" | "purple"` or `#rrggbb`. Named `"purple"` / `"gray"` / `"grey"` are not rewritten when the displayed chip is unchanged. `""` / `"none"` are not stored. Hoverbar none stays omitted (`encodeIfPresent`), not JSON `null`.

## AppKit / SwiftUI

`ActivateAwareColorWell` and `TintColorWell.Coordinator` are `@MainActor`. `onChange(of:)` one-parameter form is the macOS 13 API (`Package.swift`). `Binding(get:set:)`, `ObservableObject`, and several types per file already exist in Settings; not smells. Chip buttons have names + `.isSelected`. Visible label “Lil Nap tint” matches `CONTEXT.md`. ADR-0001: still one native Settings surface.

No `verified:` comments were added or drifted. Evidence notes in the diff are not product docs.
