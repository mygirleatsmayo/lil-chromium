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

    /// The top-hit host for the current query, if a host prefixes it — used to
    /// drive inline type-ahead autocomplete. Returns the host (sans "www.") of
    /// the highest-scoring host-prefix origin, else nil.
    func autocompleteHost(for query: String) -> String? {
        let ranked = Ranking.rank(query: query, index: index, limit: 1)
        guard let first = ranked.first,
              let host = first.autocompleteHostValue else { return nil }
        return host
    }

    /// Compute the rows to display for `query`.
    ///
    /// Order (non-URL query):
    ///   1. top hit (best host-prefix origin or best page)
    ///   2. "Search {engine} for '<query>'"
    ///   3. remaining history matches (filling to the cap)
    /// When the input parses as a URL: an "Open <url>" row REPLACES position 1.
    /// Empty query: top-8 by frecency, no search row.
    func rows(for query: String) -> [PaletteRow] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)

        if trimmed.isEmpty {
            let matches = Ranking.rank(query: "", index: index, limit: maxRows)
            return matches.map { historyRow($0) }
        }

        var rows: [PaletteRow] = []
        let looksURL = URLIntent.looksLikeURL(trimmed)

        // Budget: reserve one slot for the search row and (if URL) the open row.
        var budget = maxRows
        if !trimmed.isEmpty { budget -= 1 }   // search row
        budget = max(0, budget)

        let matches = Ranking.rank(query: trimmed, index: index, limit: budget)

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
            // Then the search row, then history.
            rows.append(searchRow(trimmed))
            for m in matches { rows.append(historyRow(m)) }
        } else {
            // Position 1 = top hit (first ranked match), position 2 = search,
            // then the remaining matches.
            if let top = matches.first {
                rows.append(historyRow(top))
            }
            rows.append(searchRow(trimmed))
            for m in matches.dropFirst() { rows.append(historyRow(m)) }
        }

        return Array(rows.prefix(maxRows))
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
