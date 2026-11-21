# Issue #54 findings ledger

Original fixed point: `feat/implement-ready-tickets` (`bea1bbe`)
Initial reviewed point: `66fec01`

Verdicts pending Lucas; the orchestrator's recommendation follows each.

## Standards

- S1 · Accepting a completion reruns URL intent on the scheme-free text, so Return can change: `http://intranet.example:8080` becomes `https://`, `https://localhost:3000` becomes `http://`, `[::1]:3000` searches (integration ledger P8: field, top row and Return agree) · same cause as P1 · recommend **won't-fix here, follow-up ticket**: #54 puts typed text that names a history site out of scope. Chrome fixes this by resolving such text to the history URL (`HistoryURLProvider::FixupExactSuggestion`), which touches the URL-intent contract the hoverbar shares (#39).
- S2 · A site row rebuilds its URL from the normalized site, so `https://www.example.com:8443/wiki` opens `https://example.com:8443` (Chrome: the winning history URL with its path removed) · recommend **fix**, overriding #54's out-of-scope line on `www.` (the orchestrator wrote it to keep the ticket thin; Chrome keeps the history URL's host): the site row opens its winning page's URL with path, query and fragment removed. The site key for grouping stays as it is.
- S3 · `site: String` is the grouping key, the completion text and the URL authority (possible Primitive Obsession) · same change as S2 · recommend **fix** with S2.
- S4 · `(acc.url, acc.urlFrecency, acc.urlLastVisit)` travel together; `opens` names a ranking key (possible Data Clumps, Mysterious Name) · recommend **fix** with S2: one candidate value.

## Spec

- P1 · "Accepting the completion and then pressing Return opens the same URL" · same as S1 · recommend **won't-fix here, follow-up ticket**.
- P2 · "`localhost:5` completes to `localhost:5173`": a frecent `:3000` page titled `localhost:5173 migration` can outrank the `:5173` site, so no completion · recommend **won't-fix**: needs a title that names another port; frecency outranking match tier among eligible rows is the #13 ranking rule.
- P3 · "`swift test` covers each criterion above": the site-row fixture has no query or fragment · recommend **fix**.
- P4 · Page subtitles show the port; a bare `3000` matches the `localhost:3000` site row below Search · recommend **accept**: both follow from a site being a host plus port; Chrome shows ports and matches URL text; Search stays on top.

## Lucas's rulings on full review 1

- S2, S3, S4, P3: **fix**, as recommended.
- P2: **won't-fix**, as recommended.
- P4: **accept**, as recommended.
- S1, P1: **open**. Lucas asked why it can't land in this PR. Chrome resolves typed text that names a visited URL to that URL in its history provider, on top of URL reading (`HistoryURLProvider::VisitClassifier`, which tries the input under each URL prefix against the URL database), so the URL-intent rules and the hoverbar stay as they are. The orchestrator now recommends fixing it here.

## Fix round 1 (`58ad5c2...699b821`)

- S2, P3: `a4a08e2`. S3: `c003d9a`. S4: `699b821`.
- A site row's URL drops any `user:pass@`, where Chrome's `GetWithEmptyPath` keeps it. Moot: browser history stores no credentials (`HistoryURLProvider::VisitClassifier`: "the history backend strips auth creds").

## Lucas's rulings after fix round 1

- S1, P1: **fix**. Field text that names an origin in history, as that origin's completion shows it, opens that origin's URL from history, so Return opens the same URL whether the text was typed or accepted. The URL-intent rules (PROTOCOL.md *URL intent*) and the hoverbar stay as they are; Chrome's history provider resolves typed text against visited URLs on top of URL reading (`HistoryURLProvider::VisitClassifier`). Out of scope: page URLs typed out in full; the hoverbar.
- R1 · **rename**: the palette's *site* (a host plus its port; http and https, with or without `www.`, count as one) is an *origin* in code, matching the existing "origin row" name and Firefox's origin autofill (`moz_origins` holds host and port; `UrlbarProviderAutofill` totals frecency across prefixes and `www.`). The web's *site* ignores ports and subdomains. The glossary entry is proposed on #37.

## Fix round 2 (`20123f4...7e58c4c`, plus the orchestrator's PROTOCOL.md line)

- R1: `7639af8`. S1, P1: `7e58c4c`. PROTOCOL.md's palette line now says text naming a history origin opens that origin's URL.
- Accepted, as Chrome does it: typed `example.com` with only `http://example.com` in history opens http (`VisitClassifier` tries the `http://` prefix against visited URLs); this supersedes #54's out-of-scope line on rule 8 for text that names an origin. A single-label origin typed in full (`intranet`) leads with its Open row (Chrome promotes the what-you-typed match when the input is a visited URL).
- Accepted as is: after accepting, the Open row and the origin row below Search open the same URL, as typed URLs such as `github.com` already do. Pre-#54 names that use "site" in plain English (`oneSiteCannotFloodTheList`) stay.
