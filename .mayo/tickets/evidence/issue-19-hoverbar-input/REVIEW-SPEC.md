# Spec review — issue #19 (hoverbar input)

**Verdict:** No spec findings.

Fixed point `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` · Review head `94bf858b708617622eb1f40f85b9bd904acdc2b7` · both resolve, diff non-empty. Sources: `gh issue view 19` (0 comments), `gh issue view 2` (0 comments), ledgers #4/#9/#12/#14, `CONTEXT.md`, `docs/PROTOCOL.md`.

## 1. Missing or partial

None.

## 2. Unrequested behavior

None user-facing. Immediate `hide()` on the second focused Escape matches issue #19 “Escape closes suggestions first and the hoverbar on the subsequent applicable Escape” and PROTOCOL “Esc hides”; it only stops the prior same-event collision with document-capture Escape. `linkedom` is test-only. PROTOCOL’s new isolation sentence is extension-only (parent #2 ID 51 does not require app/host messages).

## 3. Implemented but wrong

None. Bubble `stopPropagation` on `addr`/`omni` for `keydown`/`keyup`/`keypress` without `preventDefault` matches PROTOCOL: “consumed at that overlay editing boundary so the host page cannot observe or act on them; native insertion, paste, selection, deletion, arrows, and input methods are not canceled”. GitHub `@github/hotkey` listens on `document` in bubble and skips form fields; closed-shadow retargeting is the leak this stops. Capture-phase page listeners still run before the field; the ticket names “GitHub-like” containment and leaves “shortcut-heavy pages” to real-Mac QA (issue #19 last AC; parent #2 Testing Decision 12).

## Checked

1. **Isolation while field/suggestions own focus** — issue #19 AC1–2; parent #2 US 64 and ID 39; PROTOCOL hover-reveal sentence. `containEditingKey` on address + omnibox; page still hears keys when unfocused.
2. **Editing preserved** — issue #19 AC3; parent #2 US 15, ID 39; PROTOCOL “not canceled”. Isolation never `preventDefault`s; suggestion arrows still do (PROTOCOL omnibox “arrow keys + Enter”).
3. **⌘L + reveal-zone 0** — issue #19 AC4; parent #2 US 41/62, ID 38; PROTOCOL “⌘L still reveals”; CONTEXT.md Reveal zone. `focusAddress` ignores the zone; #12 live `hoverBar.revealHeight` unchanged.
4. **Two-stage Escape** — issue #19 AC5; PROTOCOL “Esc closes dropdown first, bar second.” Document capture returns while `addrFocused()`.
5. **A11y / unobtrusive / live zone** — issue #19 AC6–7; parent #2 Solution “unobtrusive”. No chrome/pointer/label change; host still `pointer-events: none`.
6. **MV3 containment vs QA** — issue #19 AC8; parent #2 TD 3/12/14; ledger #4 production-file execution. Harness loads `extension/overlay.js`; paste/IME/GitHub remain QA.
7. **Settled ledgers** — #12 hot-apply/reveal; #9 Settings row; #14 palette chords. No conflicting hoverbar-isolation interpretations.
