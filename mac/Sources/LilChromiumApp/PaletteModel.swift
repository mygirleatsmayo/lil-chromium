import AppKit
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

/// What the palette field holds (issue #38): the text the user typed and, while
/// inline type-ahead shows one, the history row it completes to. On the top
/// row the field displays `text` with `completionRange` selected; on another
/// row, that row's preview (`display(previewing:)`). The completion is the
/// default action, so the field, the selected row, and Return never disagree.
struct PaletteInput {
    /// Text the user entered; excludes the auto-appended remainder.
    fileprivate(set) var typed = ""
    /// The origin row whose host the field is completed to, if any.
    fileprivate(set) var completion: PaletteRow?

    /// The full field text: typed text plus the completed host's remainder,
    /// with the user's casing kept for the typed prefix.
    var text: String {
        guard let host = completion?.host else { return typed }
        return typed + host.dropFirst(typed.count)
    }

    /// The selected remainder in UTF-16 units (NSRange), nil with no completion.
    var completionRange: NSRange? {
        guard completion != nil else { return nil }
        let base = (typed as NSString).length
        return NSRange(location: base, length: (text as NSString).length - base)
    }

    /// The user changed the field text (typing, deleting, pasting): it is the
    /// query now, with no completion until its ranking lands
    /// (`PaletteModel.completing`). Returns whether that ranking may offer
    /// one, as Chrome decides: the edit extends the typed text (never a
    /// deletion), leaves the caret at the end (`selection` starts there), and
    /// is not a paste. Chrome: `OmniboxViewViews::UpdatePopup`,
    /// `OmniboxEditModel::StartAutocomplete`. Only edits offer a completion,
    /// so a paste blocks it until the next edit, as Chrome's paste state does
    /// (`OmniboxEditModel::OnAfterPossibleChange`).
    mutating func edit(to newText: String, selection: NSRange, pasted: Bool) -> Bool {
        let offers = !pasted
            && selection.location == (newText as NSString).length
            && newText.count > typed.count
            && newText.lowercased().hasPrefix(typed.lowercased())
        typed = newText
        completion = nil
        return offers
    }

    /// The field's selection moved. If the field still shows the completed
    /// text but the remainder is no longer exactly selected (→, ⌘→, End, a
    /// click), the user accepted it: the full text becomes the typed query.
    /// Returns whether the query changed. A selection change that arrives
    /// with different text belongs to an edit and is left to `edit`.
    mutating func selectionDidChange(to range: NSRange, in fieldText: String) -> Bool {
        guard let completionRange, fieldText == text, range != completionRange else {
            return false
        }
        acceptCompletion()
        return true
    }

    /// What the field shows while `row` is selected, nil for the top row.
    /// The top row shows `text` with the completion's remainder selected.
    /// Any other row previews, caret at the end: a history row's URL as
    /// Chrome's field shows it (`URLIntent.fieldText`), an Open row's URL
    /// with no scheme the user didn't type, or the typed text (Search,
    /// Settings). A preview never changes the query; editing it does, through
    /// `edit`.
    /// Browser precedent (r04 §2): Chrome and Firefox show the arrow-selected
    /// result in the field; Firefox restores the autofill on reselecting the
    /// top row.
    func display(previewing row: PaletteRow?) -> (text: String, selection: NSRange) {
        func caretAtEnd(of text: String) -> NSRange {
            NSRange(location: (text as NSString).length, length: 0)
        }
        guard let row else { return (text, completionRange ?? caretAtEnd(of: text)) }
        let shown = switch row.kind {
        case .history: URLIntent.fieldText(forHistoryURL: row.actionURL, typed: typed)
        case .openURL: URLIntent.fieldText(forOpenURL: row.actionURL, typed: typed)
        case .search, .settings: typed
        }
        return (shown, caretAtEnd(of: shown))
    }

    /// A key command reached the field, which shows `fieldText`, before its
    /// editor runs it. End accepts a displayed completion here because its
    /// command only scrolls; → and ⌘→ move the caret and accept through
    /// `selectionDidChange`. A field previewing another row has no completion
    /// to accept. Returns whether the query changed (the caller then consumes
    /// the command).
    /// verified: StandardKeyBinding.dict plus a live field editor — → sends
    /// moveRight: and ⌘→ moveToRightEndOfLine:, each then posting the caret at
    /// the end; End sends scrollToEndOfDocument: and leaves the selection.
    mutating func handle(_ command: Selector, in fieldText: String) -> Bool {
        guard command == #selector(NSResponder.scrollToEndOfDocument(_:)),
              completion != nil, fieldText == text else {
            return false
        }
        acceptCompletion()
        return true
    }

    private mutating func acceptCompletion() {
        typed = text
        completion = nil
    }
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

    /// Row budget and word matching (issue #43). Cached per palette open like
    /// `searchEngine`. `maxResults` counts every row and arrives clamped.
    var config: PaletteConfig = .defaults
    private var maxRows: Int { config.maxResults }

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
        copy.config = config
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

    /// The results to render for a ranking that landed, or nil when a newer
    /// ranking began or rankings were outdated since `ticket` was taken.
    func land(_ results: PaletteResults, from ticket: RankingTicket) -> PaletteResults? {
        ticket.number == newestRanking ? results : nil
    }

    /// Resolve Return at the native palette boundary. Unsupported modifier
    /// combinations return nil so extra keys cannot fall through to an action.
    func action(
        for query: String,
        selectedRow: PaletteRow?,
        chord: PaletteReturnChord
    ) -> PaletteAction? {
        if chord == [.shift] || chord == [.command, .shift] {
            let incognito = chord == [.command, .shift]
            return searchAction(
                for: query.trimmingWhitespace(),
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

    /// What Return does right now: the selected row's action, never the
    /// hovered one's. The controller's Return handler and the selected row's
    /// hint both resolve through here, so they cannot disagree.
    func returnAction(
        for query: String,
        rows: [PaletteRow],
        selection: PaletteSelection,
        chord: PaletteReturnChord
    ) -> PaletteAction? {
        guard rows.indices.contains(selection.selected) else { return nil }
        return action(for: query, selectedRow: rows[selection.selected], chord: chord)
    }

    /// Resolve Tab: search for the typed text whatever row is selected (the
    /// Raycast Tab-to-Quick-AI pattern). Same action as ⇧Return. The hint is
    /// the input row's trailing `Search ⇥` label; nil (no action, no hint)
    /// for an empty query.
    func tabAction(for query: String) -> PaletteAction? {
        let trimmed = query.trimmingWhitespace()
        guard !trimmed.isEmpty else { return nil }
        return searchAction(for: trimmed, incognito: false, hint: "Search ⇥")
    }

    /// The forced-search action shared by ⇧Return, ⇧⌘Return, and Tab:
    /// search the configured engine for `query` (already trimmed).
    private func searchAction(for query: String, incognito: Bool, hint: String) -> PaletteAction {
        PaletteAction(
            kind: .search,
            url: searchRow(query).actionURL,
            incognito: incognito,
            hint: hint
        )
    }

    /// The rows to display for `query` (see `results(for:)`).
    func rows(for query: String) -> [PaletteRow] {
        results(for: query).rows
    }

    /// The ranking of `input.typed` landed: complete the field to its
    /// type-ahead host when the typed text strictly prefixes that host. The
    /// completion is worked out afresh, so after a history refresh one the
    /// new history doesn't offer is dropped, as Chrome re-applies the default
    /// match's completion whenever results change
    /// (`OmniboxEditModel::OnCurrentMatchChanged`).
    func completing(_ input: PaletteInput, with results: PaletteResults) -> PaletteInput {
        var next = input
        next.completion = nil
        guard !input.typed.isEmpty, let host = results.autocompleteHost,
              host.lowercased().hasPrefix(input.typed.lowercased()),
              host.count > input.typed.count else { return next }
        next.completion = originRow(host: host)
        return next
    }

    /// Rows for the field state, ranked now (see `rows(for:typedRows:)`).
    func rows(for input: PaletteInput) -> [PaletteRow] {
        rows(for: input, typedRows: rows(for: input.typed))
    }

    /// Rows for the field state, given `typedRows` ranked for `input.typed`.
    /// A displayed completion leads; below it sit the typed text's own rows,
    /// minus the history row for the same destination. Open and Search rows
    /// always stay.
    func rows(for input: PaletteInput, typedRows: [PaletteRow]) -> [PaletteRow] {
        guard let top = input.completion else { return typedRows }
        let rest = typedRows.filter {
            $0.kind != .history || !Ranking.isSameDestination($0.actionURL, top.actionURL)
        }
        return Array(([top] + rest).prefix(maxRows))
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
    /// Empty query: top `maxRows` by frecency, no search row.
    ///
    /// The autocomplete host comes from the same ranking pass: when a history
    /// row sits above Search, that is the host Enter opens — ghost text must
    /// name it too. Otherwise the best history match's host, else nil.
    func results(for query: String) -> PaletteResults {
        let trimmed = query.trimmingWhitespace()

        if trimmed.isEmpty {
            let matches = Ranking.rank(query: "", index: index, limit: maxRows)
            return PaletteResults(
                rows: matches.map { historyRow($0) },
                autocompleteHost: matches.first?.autocompleteHostValue
            )
        }

        var rows: [PaletteRow] = []
        let openURL = URLIntent.intent(of: trimmed).url

        // Rank the full candidate set before spending the display budget, so an
        // eligible registrable-label match cannot be evicted by ineligible
        // higher-tier rows that would otherwise fill `maxRows`.
        var matches = Ranking.rank(
            query: trimmed,
            index: index,
            limit: max(maxRows, index.pages.count + index.origins.count),
            wordMatch: config.wordMatch
        )
        let bestMatchHost = matches.first?.autocompleteHostValue

        if SettingsAction.matchesQuery(trimmed) {
            rows.append(settingsRow())
        }

        if let openURL {
            // Position 1 is the explicit "Open <url>" row (per contract).
            rows.append(PaletteRow(
                kind: .openURL,
                title: "Open \(trimmed)",
                subtitle: openURL,
                actionURL: openURL,
                host: Ranking.hostAndPath(openURL)?.host,
                autocompleteHost: nil
            ))
        } else if let promoted = bestEligibleIndex(in: matches) {
            rows.append(historyRow(matches.remove(at: promoted)))
        }

        rows.append(searchRow(trimmed))
        rows.append(contentsOf: matches.map(historyRow))
        rows = Array(rows.prefix(maxRows))

        let topHistoryHost = rows.first.flatMap { openURL == nil && $0.kind == .history ? $0.host : nil }
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

    /// The site row for `host`, as ranking would show its origin.
    private func originRow(host: String) -> PaletteRow? {
        guard let origin = index.origins.first(where: { $0.host == host }) else { return nil }
        return historyRow(Ranking.RankedResult(origin: origin))
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
