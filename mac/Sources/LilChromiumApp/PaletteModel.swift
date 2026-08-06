import Foundation
import LilShared

/// A single selectable row in the palette.
struct PaletteRow {
    enum Kind {
        case history
        case openURL   // "Open <url>" — input looks like a URL
        case search    // "Search Google for '<query>'"
    }

    let kind: Kind
    let title: String       // primary line
    let subtitle: String    // secondary line (URL or hint)
    let actionURL: String   // final URL to open on Enter
}

/// Owns the in-memory history snapshot and turns a query string into rows.
/// The snapshot is refreshed each time the palette opens.
final class PaletteModel {

    private(set) var items: [HistoryItem] = []
    private let maxRows = 8

    /// Replace the cached snapshot (called after a history-query completes).
    func setItems(_ items: [HistoryItem]) {
        self.items = items
    }

    /// Compute the rows to display for `query`.
    /// Ordering:
    ///   - If input looks like a URL, an "Open <url>" row goes first.
    ///   - Then history matches (fuzzy + frecency), filling up to the cap.
    ///   - If query nonempty, always append a "Search Google" row last.
    func rows(for query: String) -> [PaletteRow] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        var rows: [PaletteRow] = []

        let looksURL = URLIntent.looksLikeURL(trimmed)
        if looksURL {
            let normalized = URLIntent.normalizedURL(trimmed)
            rows.append(PaletteRow(
                kind: .openURL,
                title: "Open \(trimmed)",
                subtitle: normalized,
                actionURL: normalized
            ))
        }

        // Reserve slots for the always-on rows so history never crowds them out.
        var historyBudget = maxRows
        if looksURL { historyBudget -= 1 }
        if !trimmed.isEmpty { historyBudget -= 1 } // search row
        historyBudget = max(0, historyBudget)

        let matches = Ranking.rank(items: items, query: trimmed, limit: historyBudget)
        for m in matches {
            let title = m.title.isEmpty ? m.url : m.title
            rows.append(PaletteRow(
                kind: .history,
                title: title,
                subtitle: m.url,
                actionURL: m.url
            ))
        }

        if !trimmed.isEmpty {
            rows.append(PaletteRow(
                kind: .search,
                title: "Search Google for “\(trimmed)”",
                subtitle: "google.com/search",
                actionURL: URLIntent.googleSearchURL(trimmed)
            ))
        }

        return rows
    }
}
