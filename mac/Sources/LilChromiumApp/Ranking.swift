import Foundation
import LilShared

/// Local fuzzy-subsequence matching + frecency/recency ranking over the cached
/// history snapshot. Pure functions, easy to reason about and test.
enum Ranking {

    /// A scored candidate ready to render.
    struct Scored {
        let item: HistoryItem
        let score: Double
    }

    /// Fuzzy subsequence match score of `query` against `text`.
    /// Returns nil if `query` is not a subsequence of `text`.
    /// Rewards consecutive runs and word-boundary starts.
    static func fuzzyScore(query: String, text: String) -> Double? {
        if query.isEmpty { return 0 }
        let q = Array(query.lowercased())
        let t = Array(text.lowercased())
        if q.isEmpty { return 0 }
        if t.isEmpty { return nil }

        var qi = 0
        var score = 0.0
        var prevMatchIndex = -2
        var consecutiveRun = 0

        var ti = 0
        while ti < t.count && qi < q.count {
            if t[ti] == q[qi] {
                // Base point for a match.
                score += 1.0

                // Consecutive-run bonus (grows with run length).
                if ti == prevMatchIndex + 1 {
                    consecutiveRun += 1
                    score += Double(consecutiveRun) * 0.6
                } else {
                    consecutiveRun = 0
                }

                // Word-boundary bonus: match at start or after a separator.
                if ti == 0 || isBoundary(t[ti - 1]) {
                    score += 1.2
                }

                prevMatchIndex = ti
                qi += 1
            }
            ti += 1
        }

        // Must consume the whole query to count as a match.
        if qi < q.count { return nil }

        // Prefer shorter targets slightly (a tight match is better than a match
        // buried in a very long string).
        score += max(0, 8.0 - Double(t.count) * 0.01)
        return score
    }

    private static func isBoundary(_ c: Character) -> Bool {
        return c == " " || c == "/" || c == "-" || c == "_" || c == "." ||
               c == ":" || c == "?" || c == "&" || c == "="
    }

    /// Frecency component: log-scaled visit/typed counts.
    /// log(visitCount + 3*typedCount + 1).
    static func frecency(_ item: HistoryItem) -> Double {
        let raw = Double(item.visitCount) + 3.0 * Double(item.typedCount) + 1.0
        return log(raw)
    }

    /// Recency decay: exponential halflife of ~30 days on lastVisitTime.
    /// lastVisitTime is Chrome's epoch-milliseconds. `now` in ms.
    static func recency(_ item: HistoryItem, nowMs: Double) -> Double {
        let halfLifeDays = 30.0
        let msPerDay = 86_400_000.0
        let ageMs = max(0, nowMs - item.lastVisitTime)
        let ageDays = ageMs / msPerDay
        // 0.5 ^ (age / halflife); clamps to (0, 1].
        return pow(0.5, ageDays / halfLifeDays)
    }

    /// Rank items for a query. Empty query -> top-N by frecency*recency.
    /// Non-empty -> fuzzy(title|url) * frecency * recency.
    static func rank(items: [HistoryItem], query: String, limit: Int, nowMs: Double = Date().timeIntervalSince1970 * 1000) -> [HistoryItem] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)

        if trimmed.isEmpty {
            let scored = items.map { item -> Scored in
                let base = (frecency(item) + 0.5) * (0.2 + recency(item, nowMs: nowMs))
                return Scored(item: item, score: base)
            }
            return scored
                .sorted { $0.score > $1.score }
                .prefix(limit)
                .map { $0.item }
        }

        var results: [Scored] = []
        results.reserveCapacity(items.count)
        for item in items {
            // Best of title-match and url-match.
            let titleScore = fuzzyScore(query: trimmed, text: item.title)
            let urlScore = fuzzyScore(query: trimmed, text: item.url)
            guard let best = maxOptional(titleScore, urlScore) else { continue }

            let fr = frecency(item) + 0.5
            let rc = 0.2 + recency(item, nowMs: nowMs)
            let total = best * fr * rc
            results.append(Scored(item: item, score: total))
        }

        return results
            .sorted { $0.score > $1.score }
            .prefix(limit)
            .map { $0.item }
    }

    private static func maxOptional(_ a: Double?, _ b: Double?) -> Double? {
        switch (a, b) {
        case let (x?, y?): return Swift.max(x, y)
        case let (x?, nil): return x
        case let (nil, y?): return y
        default: return nil
        }
    }
}
