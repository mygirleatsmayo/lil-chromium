# Findings ledger — issue #14 (compose palette Return modifiers exactly)

Fixed point: `release/v0.4` (`ea58b515357bda113e3dd3b8738d4cd9fef09c93`) · Branch: `v0.4/issue-14-palette-modifiers`

Review round 1 (full, two-axis): Standards `xjDlOxjg`, Spec `mpHyAXUi`, both `cursor-grok-4.6-xhigh`.

Reports: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md` (this directory).

## Manager verification

The implementation is one clean commit (`b45e1e5`), `git diff --check` passes, and the focused `PaletteActionTests` pass. The installed macOS 27 SDK confirms that `deviceIndependentFlagsMask` includes Caps Lock, Numeric Pad, Help, and Function. Its `NSEvent.h` defines Numeric Pad as set for any numeric-keypad key, so Keypad Enter is rejected by the current equality even though it is a standard submission key. The shared S1/P1 premise is real.

## Findings

| ID | Location | Verdict | Reasoning |
|---|---|---|---|
| S1 | `PaletteModel.swift` imports AppKit and accepts `NSEvent.ModifierFlags`; tests pass AppKit flags/UInts | **fix** | The UI model should express the finite Return-chord domain, while the `@MainActor` controller translates AppKit event flags. This removes the AppKit leak and fixes the over-broad flag semantics at their boundary. |
| S2 | `PaletteController.returnModifiersOnCurrentEvent` comment claims it returns exact device-independent flags | **fix** | Keep the existing real-system `verified:` claim accurate after moving chord translation into the controller. No new `verified:` claim is owed for `flagsChanged`: that behavior has not yet been confirmed in real-Mac QA. |
| P1 | Exact matching rejects Caps Lock, Keypad Enter, Fn, or Help bits and blanks the hint | **fix** | “Exact modifiers” means the action chord, not lock state or key-origin metadata. Option and Control must still block accidental submission; non-chord bits must not. Add independent behavior cases for the four requested chords with ignored bits and for unsupported Option/Control chords. |

## Settled interpretations

1. Return chord semantics use Command, Shift, Option, and Control only.
2. Caps Lock, Numeric Pad, Function, and Help are lock/key-origin metadata for this feature. They do not block submission or blank the selected-row hint.
3. Option and Control remain unsupported extra chord modifiers. Any chord containing either produces no action.
4. Plain/Command Return still use the selected row. Shift/Command+Shift still force the current committed input through Search.
5. Issue #13's ordering, URL-intent, promotion, and ghost-text interpretations remain unchanged.

## Round 1 outcome

Three ledger items require one cohesive root fix plus focused tests and comment correction. No owner decision is needed before remediation.

## Remediation round 1 review

Review task `L0huFD1b` (`cursor-grok-4.6-xhigh`) checked only the frozen ledger and fix delta `b45e1e5...76ce648`.

- S1: resolved
- S2: resolved
- P1: resolved
- New defects: none
- Needs adjudication: none

All ledger fixes are resolved. Proceed to the required final full two-axis review with these settled interpretations attached.

## Final full review

Final Standards task `uZa1fIl3` and Spec task `GOVWyk4C`, both `cursor-grok-4.6-xhigh`, reviewed `ea58b515...e64f959` with this ledger attached.

- Standards: no new findings, no ledger regressions, no adjudication needed
- Spec: no new findings, no ledger regressions, no adjudication needed

The code-review loop is complete. Final manager verification and explicit owner merge approval remain.
