import Foundation
import LilShared

/// A single selectable row in the palette.
struct PaletteRow {
    enum Kind {
        case history     // a page or origin match (favicon)
        case openURL     // "Open <url>" — input parses as a URL (globe/arrow)
        case search      // "Search {engine} for '<query>'" (magnifier)
        case settings    // native Settings window (gear)
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

/// The fully resolved action produced by pressing Return in the palette.
struct PaletteAction: Equatable {
    enum Kind {
        case open
        case search
        case settings
    }

    let kind: Kind
    let url: String
    let incognito: Bool
    let hint: String
}

/// One query's rows and inline type-ahead host, from a single ranking pass.
struct PaletteResults {
    let rows: [PaletteRow]
    let autocompleteHost: String?
}

/// The only modifier keys that participate in a palette Return chord.
/// AppKit lock state and key-origin metadata never cross this boundary.
struct PaletteReturnChord: OptionSet, Equatable, Sendable {
    let rawValue: UInt8

    static let shift = Self(rawValue: 1 << 0)
    static let command = Self(rawValue: 1 << 1)
    static let option = Self(rawValue: 1 << 2)
    static let control = Self(rawValue: 1 << 3)
    static let plain: Self = []
}

/// Owns the in-memory history snapshot (as a prebuilt `Ranking.HistoryIndex`)
/// and turns a query string into ordered rows.
///
/// The index is rebuilt only when a new snapshot arrives (once per palette
/// open). Ranking a keystroke still scans the whole window, so the controller
/// runs it off the main thread on a `copy()`.
final class PaletteModel {

    private(set) var index: Ranking.HistoryIndex = .empty
    let maxRows = 8

    /// The search engine used to build the "Search {name} for …" row and its
    /// action URL. Cached per palette open (set by the controller in show()) so
    /// per-keystroke row building doesn't re-read config.json. Defaults to
    /// Startpage.
    var searchEngine: SearchEngineConfig = .defaults

    /// An independent copy of the snapshot and engine, so a keystroke can be
    /// ranked off the main thread while the original keeps changing (issue #41).
    func copy() -> PaletteModel {
        let copy = PaletteModel()
        copy.index = index
        copy.searchEngine = searchEngine
        return copy
    }

    // MARK: - Out-of-date results (issue #41)

    /// A history refresh in flight. Only the newest may install its snapshot.
    struct RefreshTicket: Equatable { fileprivate let number: Int }
    /// A keystroke ranking in flight. Only the newest may render.
    struct RankingTicket: Equatable { fileprivate let number: Int }

    private var newestRefresh = 0
    private var newestRanking = 0

    func beginRefresh() -> RefreshTicket {
        newestRefresh += 1
        return RefreshTicket(number: newestRefresh)
    }

    /// Install `index` unless a newer refresh began after `ticket`'s, so an
    /// older refresh that lands last never replaces a newer snapshot.
    @discardableResult
    func install(_ index: Ranking.HistoryIndex, from ticket: RefreshTicket) -> Bool {
        guard ticket.number == newestRefresh else { return false }
        self.index = index
        return true
    }

    /// Begin a ranking; every earlier ranking is now out of date.
    func beginRanking() -> RankingTicket {
        newestRanking += 1
        return RankingTicket(number: newestRanking)
    }

    /// Put every ranking in flight out of date (close, or Return settling).
    func outdateRankings() {
        newestRanking += 1
    }

    func isCurrent(_ ticket: RankingTicket) -> Bool {
        ticket.number == newestRanking
    }

    /// Replace the cached snapshot and rebuild the index off the main thread's
    /// hot path is the caller's job; this just stores the prebuilt index.
    func setIndex(_ index: Ranking.HistoryIndex) {
        self.index = index
    }

    /// Resolve Return at the native palette boundary. Unsupported modifier
    /// combinations return nil so extra keys cannot fall through to an action.
    func action(
        for query: String,
        selectedRow: PaletteRow?,
        chord: PaletteReturnChord
    ) -> PaletteAction? {
        if chord == [.shift] || chord == [.command, .shift] {
            let row = searchRow(query.trimmingCharacters(in: .whitespacesAndNewlines))
            let incognito = chord == [.command, .shift]
            return PaletteAction(
                kind: .search,
                url: row.actionURL,
                incognito: incognito,
                hint: incognito ? "⇧⌘⏎ Search Incognito" : "⇧⏎ Search"
            )
        }
        let incognito: Bool
        switch chord {
        case .plain:
            incognito = false
        case [.command]:
            incognito = true
        default:
            return nil
        }
        guard let selectedRow else { return nil }

        if selectedRow.kind == .settings {
            return PaletteAction(
                kind: .settings,
                url: selectedRow.actionURL,
                incognito: false,
                hint: "⏎ Settings"
            )
        }

        let kind: PaletteAction.Kind = selectedRow.kind == .search ? .search : .open
        let verb = kind == .search ? "Search" : "Open"
        let shortcut = incognito ? "⌘⏎" : "⏎"
        let suffix = incognito ? " Incognito" : ""
        return PaletteAction(
            kind: kind,
            url: selectedRow.actionURL,
            incognito: incognito,
            hint: "\(shortcut) \(verb)\(suffix)"
        )
    }

    /// The rows to display for `query` (see `results(for:)`).
    func rows(for query: String) -> [PaletteRow] {
        results(for: query).rows
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
    ///
    /// The autocomplete host comes from the same ranking pass: when a history
    /// row sits above Search, that is the host Enter opens — ghost text must
    /// name it too. Otherwise the best history match's host, else nil.
    func results(for query: String) -> PaletteResults {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)

        if trimmed.isEmpty {
            let matches = Ranking.rank(query: "", index: index, limit: maxRows)
            return PaletteResults(
                rows: matches.map { historyRow($0) },
                autocompleteHost: matches.first?.autocompleteHostValue
            )
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
        let bestMatchHost = matches.first?.autocompleteHostValue

        if SettingsAction.matchesQuery(trimmed) {
            rows.append(settingsRow())
        }

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
        rows = Array(rows.prefix(maxRows))

        let topHistoryHost = rows.first.flatMap { !looksURL && $0.kind == .history ? $0.host : nil }
        return PaletteResults(rows: rows, autocompleteHost: topHistoryHost ?? bestMatchHost)
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

    private func settingsRow() -> PaletteRow {
        PaletteRow(
            kind: .settings,
            title: "Settings",
            subtitle: "Lil Chromium",
            actionURL: SettingsAction.urlString,
            host: nil,
            autocompleteHost: nil
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
