# Implementation evidence — issue #19 (isolate hoverbar editing)

Branch: `surfx/implement-issue-19-isolate-hoverbar-edit-MxeS00Q-`
Fixed point: `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2`
Ticket: `gh issue view 19` (8 ACs) · Parent: #2 (hoverbar reliability; US 15/41; Testing Decision 12 GitHub isolation)

## Agreed seams

1. **Production overlay content script** — `extension/overlay.js` loaded as Chromium loads it. Tests drive public keyboard/pointer events at the overlay/page boundary and assert what a page shortcut listener observes, plus address-field focus, suggestion navigation, Escape staging, reveal-zone 0, aria labels, and Settings in the caret menu.
2. **Existing MV3 service-worker harness** — unchanged; no worker/message/config change.

Harness-only: `extension/test/overlay-harness.js` loads production `overlay.js` (closed shadow still requested). Linkedom builds the tree; the harness adds composed keyboard dispatch and focus because linkedom does not leak shadow events to the document. No product test hook.

Not automated here (real-Mac QA): paste, IME/input-method chrome, and shortcut-heavy pages such as GitHub.

## Red → green slices

1. **Containment.** RED: page `keydown` heard `s` while the address field was focused. GREEN: `keydown`/`keyup`/`keypress` on the address field and suggestions call `stopPropagation` only — no `preventDefault`.
2. **Non-focus leak.** Page still hears keys when the field is not focused (no document-wide suppression).
3. **Reveal-zone 0 + ⌘L.** Mouse `clientY` inside a 0 zone does not show the bar; ⌘L still reveals and focuses. Live `contextUpdate` still supplies the zone (issue #12).
4. **Two-stage Escape.** RED: document-capture Escape closed suggestions and the field handler treated the same event as the second Esc. GREEN: document-capture Escape returns while the field is focused; the field handler closes suggestions first and hides on the next Esc.
5. **Editing/navigation.** ArrowDown with suggestions `preventDefault`s and moves selection; Backspace/`s` do not. Neither leaks to the page.
6. **A11y / #9.** `aria-label="Address"`, host `pointer-events: none`, bar CSS `pointer-events: auto`, caret still offers Settings….

## Acceptance criteria → evidence

| AC | Evidence |
|---|---|
| While the address field or suggestions own focus, relevant keyboard events are consumed at the overlay boundary before the page can act | `keystrokes in the focused address field do not reach page shortcut listeners`; `arrow keys still navigate suggestions without leaking to the page` |
| GitHub-like site shortcuts do not observe or respond to text typed into the address field | Same containment tests (document `keydown` bubble, GitHub `@github/hotkey` shape). Real GitHub is remaining QA |
| Standard text entry, paste, selection, deletion, arrow navigation, and input-method behavior remain available | Letters/Backspace: `defaultPrevented === false`; arrows with suggestions still `preventDefault` as before. Paste/IME: remaining QA |
| Command+L always reveals and focuses, including when mouse reveal is disabled | `Command+L reveals and focuses the address field when mouse reveal is disabled` |
| Escape closes suggestions first and the hoverbar on the subsequent applicable Escape | `Escape closes suggestions first and the hoverbar on the next Escape` |
| Keyboard isolation does not break screen-reader labels, focus order, or pointer interaction | `keyboard isolation keeps address labels, pointer-transparent chrome, and Settings` |
| Hidden hoverbar remains unobtrusive and honors the live reveal-zone setting | Reveal-height 0 mouse path in the ⌘L test; overlay still reads `hoverBar.revealHeight` live (#12) |
| MV3 behavior checks cover event containment; focused real-Mac QA covers paste and shortcut-heavy pages | Overlay tests above; QA seam below |

## Remaining real-Mac QA seam

Live Lil Chromium was not installed, launched, or reloaded.

1. In a lil on github.com, ⌘L, type `s` / `t` / `g` `i` — GitHub shortcuts must not fire; characters appear in the field.
2. Paste (⌘V), select-all, delete, and a non-Latin IME composition in the address field.
3. Reveal-zone slider at 0: mouse at the top edge does not reveal; ⌘L still does.
4. Settings… from the hoverbar caret still opens native Settings (#9).

## Commands and results

- `node --test extension/test/overlay.test.js` — 7 passed
- `pnpm test` — 89 passed
- `swift test` in `mac/` — 163 tests / 16 suites passed
- `make app` — release bundle at `mac/build/LilChromium.app` (worktree only; no install)
- `git diff --check` — clean
- `node --check extension/overlay.js` — clean

## Changed files

- `extension/overlay.js` — consume editing keys at the address/suggestions boundary; skip document-capture Escape while the field is focused; hide immediately on the second Esc
- `extension/test/overlay-harness.js` — production overlay mount seam
- `extension/test/overlay.test.js` — containment / editing / reveal / Escape / Settings
- `docs/PROTOCOL.md` — overlay editing-boundary contract (extension-only; no message/config/host change)
- `package.json` / `pnpm-lock.yaml` — test-only `linkedom`
- `.mayosdd/tickets/evidence/issue-19-hoverbar-input/IMPLEMENTATION.md`
