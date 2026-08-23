# Remediation round 1 — issue #12

Branch: `surfx/remediate-issue-12-round-1-outcome-resol-l1vQcIR0`
Fixed point: `3c36c9a97d94e5ac9211b81c94e3ec72e226a558`
Reviewed code: `9423784f1c4a666dd68618f9e894de5b43b9f4e5`
Pre-fix / ledger: `26a9ecd`
Ledger: `.mayosdd/tickets/evidence/issue-12-hot-apply-settings/ledger.md` (frozen; not edited)
Review evidence: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md` (preserved)

Seams (issue #12 agreed, no new seam):
1. Native `LilShared` message/config boundary (`LilChromiumTests` + `fixtures/`).
2. Settings UI is not a unit-test seam (Swift Testing has no UI tests; overlay/host loop likewise).

## Ledger rows

| ID | Status | What changed |
|---|---|---|
| S1 | resolved | PROTOCOL Settings singleton sentence uses “live relays” and “lils”. |
| S2 | resolved | `handleGetContext` and `ConfigUpdateMessage` both go through `ContextPayload` via `ContextMessage(id:browser:config:)`. |
| S3 | resolved | Reveal-zone px caption has no fixed width; slider `accessibilityValue` is “N px”. Layout otherwise unchanged. |

## S1 — domain terms in PROTOCOL

`docs/PROTOCOL.md` Settings singleton (hot-apply sentence):

- Before: `so all connected browsers and lils converge without waiting for a reconnect`
- After: `so all live relays and lils converge without waiting for a reconnect`

No protocol shape change. “connected browser” is the avoided synonym (`CONTEXT.md`).

## S2 — one ContextPayload path

`ContextPayload` stays the only browser/name mapping.

- `ContextMessage.init(id:browser:config:)` (`Messages.swift`) fills config fields from `ContextPayload.displayName` / `ContextPayload.browsers`. Host identity is still `browser` + `BrowserTable.name(forSlug:)`.
- `lilchromium-host/main.swift` `handleGetContext` dropped the duplicated local `displayName` / `known` mapping and builds `ContextMessage(id:browser:config:)`.

Reconnect `context` and Settings `config-update` cannot diverge on those fields.

### Red then green

Command:

```
swift test --filter contextAndConfigUpdateShareBrowserNormalization
```

(from `mac/`)

**Red** (test present; no `ContextMessage(id:browser:config:)`):

```
error: extra arguments at positions #1, #2, #3 in call
let ctx = ContextMessage(id: "ctx-1", browser: "brave", config: config)
```

**Green** (after shared init + host call site):

```
✔ Test contextAndConfigUpdateShareBrowserNormalization() passed after 0.001 seconds.
✔ Test run with 1 test in 1 suite passed
```

Independent literals: host `brave`/`Brave`, primary `helium`/`Helium`, clamped revealHeight `48`, known slugs `helium, chrome, vivaldi`; empty-config catalog fallback matches `ConfigUpdateMessage`.

## S3 — reveal-zone caption and VoiceOver

`SettingsWindow.swift` Hoverbar `LabeledContent("Reveal zone")`:

- Removed `.frame(width: 44, alignment: .trailing)` from the `N px` caption (Dynamic Type).
- Slider `.accessibilityValue("\(store.config.hoverBar.revealHeight) px")`.
- Visible `Text("… px")` + `.monospacedDigit()` + secondary style kept. Slider range/step, caption copy, and section layout unchanged.

Not unit-tested (not a seam).

## Verification

`pnpm test` — 42/42 pass.

```
ℹ tests 42
ℹ pass 42
ℹ fail 0
ℹ duration_ms 695.490042
```

`swift test` in `mac/` — 151 tests, 14 suites, pass (was 150; +1 `contextAndConfigUpdateShareBrowserNormalization`).

`make app` — `mac/build/LilChromium.app` assembled (worktree only; live `/Applications` not replaced).

`git diff --check` — clean.

Changed files:

- `docs/PROTOCOL.md`
- `mac/Sources/LilShared/Messages.swift`
- `mac/Sources/lilchromium-host/main.swift`
- `mac/Sources/LilChromiumApp/SettingsWindow.swift`
- `mac/Tests/LilChromiumTests/MessageTests.swift`
- `.mayosdd/tickets/evidence/issue-12-hot-apply-settings/REMEDIATION-1.md`
