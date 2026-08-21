# Standards review — issue #15 (`ea58b515…a236e3a2`)

Axis: documented repo standards + Fowler ch.3 baseline (judgement) + Swift Testing. Not a spec review.

Diff: `docs/PROTOCOL.md`, extension worker + tests, shared fixtures, `Messages.swift`, app send path, host `restore-focus`.

## Hard — documented standards

**H1 (high)** — `extension/background.js` `:265–267`, `:769–775`.

**Rule:** `docs/PROTOCOL.md` Prior context (v4): `WINDOW_ID_NONE` is meaningful external focus; when a focused lil closes, consult its predecessor once (focus that window or send `restore-focus`). `AGENTS.md`: the extension suite drives the production worker.

```
chrome.windows.onFocusChanged.addListener((windowId) => {
  focusedWindowId = windowId;
});
const wasFocused = focusedWindowId === windowId;
if (wasLil && wasFocused) {
  await restorePriorContext(entry ? entry.priorContext : incognitoPriorContext);
}
```

Chrome documents `onFocusChanged(WINDOW_ID_NONE)` immediately before a window switch; on Mac, defocus always clears to NONE first. Closing a focused lil therefore often sets `focusedWindowId` to NONE (or to Chromium’s incidental next window) *before* `onRemoved`. Then `wasFocused` is false and the consult is skipped — including `restore-focus` for an external app. The old MRU ignored NONE, so this is new.

The suite cannot catch it: `extension/test/chrome.js` `windows.remove` fires only `onRemoved`, never `onFocusChanged`.

## Judgement — baseline smells

**J1 (low, Mysterious Name)** — `openLil` splits the PROTOCOL field `priorContext` into `spec.priorContext` (explicit Chromium predecessor) and `spec.externalContext` (app-supplied, capture-gated). Same domain concept, two names; `handlePortMessage` maps the wire field onto `externalContext`.

## Swift Testing (`/swift-testing-pro`)

`mac/Tests/LilChromiumTests/MessageTests.swift`: suite is a struct; new tests use `#expect` / `throws`; parameterized `everyPriorContextKindRoundTrips`; no `!` inside `#expect`; no XCTest. No findings.

## Checked, not filed

Three-component landing is complete (PROTOCOL + `Messages.swift` + app `open` + host `restore-focus` + extension + shared fixtures). New AppKit type `ExternalAppRestorer` is `@MainActor`. No Lucas README/CHANGELOG overwrite. `type === "popup"` stays Chromium API. Cross-language `PriorContext` encode is the contract, not Duplicated Code. Required three-component edits are not Shotgun Surgery.
