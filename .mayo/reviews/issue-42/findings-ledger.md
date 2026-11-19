# Issue #42 findings ledger

Original fixed point: `bf45a2f`
Initial reviewed point: `1b572dd`

## Standards

- S1 · Moved Tier 5 comment says host/title/url; code scores title and URL only · **fix**: make the comment match the code.
- S2 · Repeated-term test passes if both queries return no history; dedupe test passes with dedupe removed · **fix**: assert expected URLs for both queries; give the duplicate enough visits to land inside the cap.
- S3 · `#expect` then `rows[1]` traps instead of failing · **fix**: `try #require` the row-shape precondition (or compare URLs directly).
- S4 · `matchTier(query:terms:…)` carries the canonical query and its terms separately (possible Data Clumps) · **fix**: one small parsed-query value.
- S5 · `gizmoPages` repeats values `visit` already supplies · **fix**: build those fixtures through `visit`.

## Spec

- P1 · "Nothing is lost … every item the current whole-query matcher returns" vs tab/extra-space queries · **won't-fix** · Settled (pending Lucas, question D): the reference for "nothing is lost" is the whitespace-normalized query. "Repeated terms and extra spaces change nothing" wins over raw-text preservation.
- P2 · "scored by the match tier of its weakest term, then by the existing frecency and tie-break order" · **won't-fix** · Settled (pending Lucas, question E): the weakest-term tier plugs into the existing `tier × frecency` score, the same formula single-term queries use. Not a lexicographic tier-then-frecency sort.
- P3 · `git git` now promotes `github.com` above Search · **won't-fix** · Settled: "multi-term" counts distinct terms after normalization, so `git git` ≡ `git` (follows from P1).
- P4 · Dedupe of equally frecent `/A` vs `/a` keeps whichever the browser reported first · **fix** · Settled: "Results stay a total order that does not depend on the order the browser reports history in" covers dedupe ties; break the lowercased-URL tie deterministically.
- P5 · Preservation test has one history row, so it passes if that row drops a tier · **fix**: assert the preserved item's tier through row order against a competitor.

## Review status

- Full review 1: 5 Standards (all fix), 5 Spec (P4, P5 fix; P1–P3 settled won't-fix, P1/P2 pending Lucas).
- Remediation 1 (`3edaf6c...8f69e48`): all 7 fix items resolved, no new defects.
