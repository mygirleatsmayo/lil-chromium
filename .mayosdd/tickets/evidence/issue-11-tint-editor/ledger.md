# Findings ledger — Issue #11: Reuse one accessible tint editor

Branch `v0.4/issue-11-tint-editor`. Fixed point `main` @ `4a4ada8`. Code at `1140bb7`.

Round 1 review: Standards `umAjHj5p` (1 finding), Spec `q5fXIzxu` (1 finding). **Both axes found the same defect independently.**

## Findings

| ID | Quote / location | Verdict | Settled interpretation |
|---|---|---|---|
| S1 = P1 | `TintValue.swift:102` — `guard let hex else { return "" }`, written via `SettingsWindow.swift:472`; pinned by `TintTests.swift:131,198` | **fix** | Lil Nap "No tint" commits `""`. The extension treats that as absent and paints purple. The user's explicit choice is discarded. |
| P2–P7, P9 | criteria 1–7 and 9 | **met** | One `TintEditor` at two call sites; correct order; `NSColorWell` + hex field; `draft` separate from `committed`; invalid drafts keep the editor visible; accessibility label and selected state on every choice; `TintTests` covers draft/commit and round trips. |

## Manager verification

The failure was confirmed in the extension source, not taken on the reviewers' word:

- `extension/background.js:1012` — `const tint = ctx.sleep && ctx.sleep.tint ? ctx.sleep.tint : "purple";`
- `extension/sleep.js:23` — `const tintParam = params.get("tint") || "purple";`
- `extension/sleep.js:49` — `resolveTint` returns `NAMED.purple` for unknown input.

`""` is falsy in both places. Confirmed: choosing "No tint" for Lil Nap paints purple.

Note the asymmetry — the hoverbar path is correct. It omits the key rather than writing `""`, and `overlay.js` applies a tint only when the value matches `/^#([0-9a-f]{3}|[0-9a-f]{6})$/i`. Only the Lil Nap path is broken.

## Settled interpretations

1. Criterion 6's "choosing no tint commits an explicit no-tint meaning" requires a value the extension can distinguish from *unset*. `sleep.tint` has a documented non-null default of `"purple"`, so **omitting the key is not sufficient** — it falls back to purple for the same reason `""` does. The fix needs an explicit sentinel honored by `background.js` and `sleep.js`.
2. The fix is a three-component change: `mac/`, `extension/`, and `docs/PROTOCOL.md` together, per `AGENTS.md`.
3. One component reused at two call sites is the shape of this ticket. Splitting it into two similar components fails criterion 1 and may not be proposed as a fix.
4. The hoverbar no-tint encoding (omitted key) is correct as shipped and is out of scope for the fix.

## Owner decision (2026-08-16) — supersedes settled interpretation 1

Lucas rejected the sentinel. His decision:

> **Lil Nap has no "no tint" choice at all.** Graphite is its neutral option. The hoverbar keeps "no tint" exactly as it ships.

This matches `docs/PROTOCOL.md`, which already makes `sleep.tint` non-nullable (`"gray" | "purple"` or `#rrggbb`) and `hoverBar.tint` nullable. The defect was that the shared editor offered Lil Nap a choice it had nowhere to store, so the fix is native-only — `extension/` and `docs/PROTOCOL.md` were correct as they stood.

Consequence recorded so no later round reverses it: dropping the no-tint chip from the Lil Nap call site is a deliberate, owner-approved deviation from Issue #11 criterion 2.

## Fix rounds

| Commit | What |
|---|---|
| `633be7c` | `TintEditor` gained `offersNoTint` (default `true`); Lil Nap passes `false`; `sleepStorage(fromCommitted:)` commits graphite `#8e8e93` instead of `""` |
| `ef729c2` | N1 — `committedHex(fromSleep:)` returns `nil` for `""`/`"none"`; setter drops its graphite fallback; `TintEditor.writeCommitted()` always assigns |

**N1** (round 3 review `Wv8zBfgv`, high): a config holding `""` or `"none"` showed graphite selected, but the click was skipped, so the unusable value stayed on disk and the extension kept painting purple. Root cause: `committedHex(fromSleep:)` coalesced `""`/`"none"` into graphite hex, so the setter's skip-guard could not tell a valid stored gray from junk that merely displayed as gray. A second skip in `TintEditor.writeCommitted()` meant the click never reached the setter at all — found by the fix round, not named in the brief.

Round 5 review `CTtPNunw`: N1 **resolved**, no new findings. It walked all six starting values and confirmed `"purple"`/`"gray"`/`"grey"` are still never rewritten into hex, and that always-assign does not let the hoverbar write on mere display.

Round 6 final full review: Standards `nkG4ldGs` and Spec `1B2tY1fn`, both **no findings**. All nine criteria met with quoted proof; every reachable `sleep.tint` write confirmed to be a value `docs/PROTOCOL.md` permits.

## Verdict

**Closed.** Ledger fully resolved after two fix rounds; final full review clean on both axes.
