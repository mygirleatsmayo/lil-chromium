# Standards review — issue #20 (enter Lil Nap)

Fixed point `3c36c9a` … head `a6494a2`. Diff non-empty.

Sources: `AGENTS.md`, `CONTEXT.md`, `docs/PROTOCOL.md`. SwiftUI-pro applied only to `SettingsWindow.swift` (copy-only hunk). Smell baseline is heuristic.

## High — documented (`docs/PROTOCOL.md` Lil Nap entry)

**`extension/background.js` `replaceTabDocument`.** Protocol: release **must** `location.replace` so the nap URL does not sit on top of the live page in back/forward.

```javascript
if (injected) return true;
await safe(chrome.tabs.update(tabId, { url }), "tabs.update sleep");
```

`safe()` plus a `tabs.update` fallback can leave `[original, nap]` in history whenever `scripting.executeScript` is missing or fails. That is a real contract breach on a path the tests treat as success only when replace wins.

## Medium — documented (`CONTEXT.md` Language)

**`SettingsWindow.swift` (hunk) and leftover Settings copy.** Prescribed actions: “Let This Lil Nap”, “Wake This Lil”. Avoid: Sleep, sleeping lil.

Changed strings use other verbs (“Let idle lils nap”, “Don’t nap lils…”) and “a napping lil”. Unchanged in the same Lils section: `TextField("Add domain (never sleep)", …)`.

**`docs/PROTOCOL.md` (adjacent sentences in the same edit).** Entry copy moved to Lil Nap; nearby lines still say “never slept” / “reopens slept lils as sleep pages”.

Whitelist menus (“Never sleep {host}”) still match the protocol’s remaining wording — not counted as a breach.

## Low — smell (Mysterious Name / Data Clumps)

**`sleepPageUrl(captureKey, originalUrl, tint, originalTitle)`** and restore:

```javascript
url: slept ? sleepPageUrl(entry.sleepCaptureKey, entry.originalUrl, undefined, entry.originalTitle) : entry.url,
```

Positional `undefined` for tint; title stuffed in query `t`. Internal `slept` / `sleep.html` kept for parked lils is an explicit tradeoff, not a new smell.

## SwiftUI-pro (`SettingsWindow.swift`)

No findings. Hunk is label text only. Existing `.foregroundStyle(.secondary)` is current API. No new accessibility, navigation, or data-flow issues in the diff.

## Checked, no finding

- `AGENTS.md`: `@MainActor` on AppKit types unchanged; no `verified:` drift; host unchanged because `sleep` config and messages are unaltered; README/CHANGELOG not overwritten.
- Contract messages / `config.json` schema / sockets / slugs: not in this diff.
- Baseline: no Feature Envy, Repeated Switches, Middle Man, or Refused Bequest in the hunks.
