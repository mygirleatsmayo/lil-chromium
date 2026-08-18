# Remediation review 2 — issue #13

Checked: ledger via `git show main:.mayosdd/tickets/evidence/issue-13-palette-ranking/ledger.md`; fix delta `git diff a9edbe8...8bac542` (code `d0d6aac`; evidence `8bac542`); `git show 8bac542` of `PaletteModel.autocompleteHost`, `rows(for:)`, `historyRow`, and `PaletteOrderingTests.promotedRowAndTypeAheadNameTheSameHost`. Interaction-only read of `PaletteController.applyAutocomplete` at `8bac542` (`:429`, unchanged). Confirmed `Ranking.rank` / `bestEligibleIndex` are outside the delta. Did not re-run tests: this worktree is not `v0.4/issue-13-palette-ranking`. Did not re-review unchanged ranking/tier code.

## Ledger

**NA1 — resolved.** `autocompleteHost(for:)` no longer picks a host from a separate `Ranking.rank(limit: 1)` call when a history row sits above Search. For non-empty, non-URL text it reuses `rows(for:)` and, if row 0 is `.history`, returns that row’s `host` — the same promotion `bestEligibleIndex` already made.

```
if !trimmed.isEmpty, !URLIntent.looksLikeURL(trimmed) {
    if let top = rows(for: query).first, top.kind == .history {
        return top.host
    }
}
```

The NA1/`hub` fixture therefore names `github.com`, not `hubspot.com`. `promotedRowAndTypeAheadNameTheSameHost` asserts kinds, action URLs, and `autocompleteHost(for: "hub") == rows[0].host`.

Scope fence holds: Search-leading queries still fall through to `rank(limit: 1)`; URL-like still skips the new branch (Open row `autocompleteHost` stays nil). `applyAutocomplete` still requires `host.hasPrefix(typed)`, so an interior promotion paints no ghost rather than the wrong host. Existing controller behavior; not a second ranking pass.

Interpretation 7 holds: when a row is promoted, type-ahead names that same host. Ghost text and Enter cannot advertise different sites.

## New findings

None of High or Medium from the delta itself.

## needs adjudication

None.

No ledger fix regressed.
