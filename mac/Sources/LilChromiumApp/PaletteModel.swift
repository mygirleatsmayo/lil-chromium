import Foundation
import LilShared

/// A single selectable row in the palette.
struct PaletteRow {
    enum Kind {
        case history     // a page or origin match (favicon)
        case openURL     // "Open <url>" — input parses as a URL (globe/arrow)
        case search      // "Search {engine} for '<query>'" (magnifier)
    }

    let kind: Kind
    let title: String        // primary line
    let subtitle: String     // secondary line: dimmed domain / shortened URL
    let actionURL: String    // final URL to open on Enter
    let host: String?        // host for favicon lookup (nil for search/openURL)

    /// The full host of a history top hit, used by inline autocomplete.
    /// Only origin/history rows carry it.
    let autocompleteHost: String?
}

/// Owns the in-memory history snapshot (as a prebuilt `Ranking.HistoryIndex`)
/// and turns a query string into ordered rows.
///
/// The index is rebuilt only when a new snapshot arrives (once per palette
/// open), so per-keystroke ranking is cheap even at 3000 items.
final class PaletteModel {

    private(set) var index: Ranking.HistoryIndex = .empty
    let maxRows = 8

    /// The search engine used to build the "Search {name} for …" row and its
    /// action URL. Cached per palette open (set by the controller in show()) so
    /// per-keystroke row building doesn't re-read config.json. Defaults to
    /// Startpage.
    var searchEngine: SearchEngineConfig = .defaults

    /// Replace the cached snapshot and rebuild the index off the main thread's
    /// hot path is the caller's job; this just stores the prebuilt index.
    func setIndex(_ index: Ranking.HistoryIndex) {
        self.index = index
    }

    /// The host offered for inline type-ahead. When a history row sits above
    /// Search, that is the host Enter opens — ghost text must name it too.
    /// Otherwise the highest-scoring host-prefix origin, else nil.
    func autocompleteHost(for query: String) -> String? {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty, !URLIntent.looksLikeURL(trimmed) {
            if let top = rows(for: query).first, top.kind == .history {
                return top.host
            }
        }
        let ranked = Ranking.rank(query: query, index: index, limit: 1)
        guard let first = ranked.first,
              let host = first.autocompleteHostValue else { return nil }
        return host
    }

    /// Compute the rows to display for `query`.
    ///
    /// Ordering (Issue #13) — non-URL text behaves like search unless history
    /// holds a literal match in a registrable domain's distinctive label:
    ///   1. the best history match whose REGISTRABLE-DOMAIN LABEL literally
    ///      contains the query, if there is one (prefix or interior; never a
    ///      public suffix, subdomain, title, path, query string, or fuzzy-only
    ///      match). Among eligible domains, frecency decides — not match tier.
    ///   2. "Search {engine} for '<query>'"
    ///   3. every remaining history match, best-first
    /// URL-like input instead leads with "Open <url>" and puts Search directly
    /// after it, so navigation is never mistaken for search.
    /// Empty query: top-8 by frecency, no search row.
    func rows(for query: String) -> [PaletteRow] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)

        if trimmed.isEmpty {
            let matches = Ranking.rank(query: "", index: index, limit: maxRows)
            return matches.map { historyRow($0) }
        }

        var rows: [PaletteRow] = []
        let looksURL = URLIntent.looksLikeURL(trimmed)

        // Rank the full candidate set before spending the display budget, so an
        // eligible registrable-label match cannot be evicted by ineligible
        // higher-tier rows that would otherwise fill `maxRows`.
        var matches = Ranking.rank(
            query: trimmed,
            index: index,
            limit: max(maxRows, index.pages.count + index.origins.count)
        )

        if looksURL {
            // Position 1 is the explicit "Open <url>" row (per contract).
            let normalized = URLIntent.normalizedURL(trimmed)
            rows.append(PaletteRow(
                kind: .openURL,
                title: "Open \(trimmed)",
                subtitle: normalized,
                actionURL: normalized,
                host: Ranking.hostAndPath(normalized)?.host,
                autocompleteHost: nil
            ))
        } else if let promoted = bestEligibleIndex(in: matches) {
            rows.append(historyRow(matches.remove(at: promoted)))
        }

        rows.append(searchRow(trimmed))
        rows.append(contentsOf: matches.map(historyRow))

        return Array(rows.prefix(maxRows))
    }

    /// Among eligible registrable-label matches, frecency is the tie-breaker
    /// (criterion 6). Match-tier `score` is ignored here; `isBefore` only
    /// breaks equal-frecency ties so the pick stays a total order.
    private func bestEligibleIndex(in matches: [Ranking.RankedResult]) -> Int? {
        var best: Int?
        for (i, r) in matches.enumerated() where r.matchesRegistrableLabel {
            guard let b = best else { best = i; continue }
            let cur = matches[b]
            if r.frecency != cur.frecency {
                if r.frecency > cur.frecency { best = i }
            } else if Ranking.isBefore(r, cur) {
                best = i
            }
        }
        return best
    }

    // MARK: - Row builders

    private func historyRow(_ r: Ranking.RankedResult) -> PaletteRow {
        let subtitle = displaySubtitle(for: r)
        return PaletteRow(
            kind: .history,
            title: r.title.isEmpty ? r.url : r.title,
            subtitle: subtitle,
            actionURL: r.url,
            host: r.host,
            autocompleteHost: r.host
        )
    }

    private func searchRow(_ query: String) -> PaletteRow {
        // Build from the configured search engine (template with %s). Subtitle
        // shows the engine's host for a compact hint.
        let actionURL = searchEngine.searchURL(for: query)
        let subtitle = URLIntent.hostForDisplay(actionURL) ?? searchEngine.name.lowercased()
        return PaletteRow(
            kind: .search,
            title: "Search \(searchEngine.name) for “\(query)”",
            subtitle: subtitle,
            actionURL: actionURL,
            host: nil,
            autocompleteHost: nil
        )
    }

    /// Dimmed domain for origin rows; shortened host + path for pages.
    private func displaySubtitle(for r: Ranking.RankedResult) -> String {
        if r.isOrigin { return r.host }
        if let (host, path) = Ranking.hostAndPath(r.url) {
            if path.isEmpty || path == "/" { return host }
            return host + path
        }
        return r.url
    }
}

private extension Ranking.RankedResult {
    /// Host to offer for inline autocomplete — only origin/history rows.
    var autocompleteHostValue: String? { host }
}
