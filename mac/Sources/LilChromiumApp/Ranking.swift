import Foundation
import LilShared

/// History ranking for the palette.
///
/// This is a full rewrite for v0.2 that fixes three concrete problems seen in
/// v0.1:
///   1. Typing "gi" surfaced a deep commit URL instead of github.com. Fixed by
///      an ORIGIN INDEX: history is aggregated per host, and a host whose name
///      (sans "www.") prefixes the query becomes the top hit, beating any
///      page-level match.
///   2. Near-duplicate junk (…/posts?q=sys, …?q=syst, …?q=syste as three rows).
///      Fixed by collapsing pages on (host + path) — query strings that differ
///      only by trailing text merge into one row — and capping results per host.
///   3. "Feels inaccurate" scattered fuzzy matches. Fixed by strict match TIERS:
///      exact host-prefix ≫ host-contains ≫ title word-boundary prefix ≫
///      contains ≫ dense fuzzy subsequence. Scattered subsequences score low and
///      a no-tier item is excluded entirely (we never show garbage).
///
/// All functions are pure and testable: `rank(query:index:)` takes a prebuilt
/// `HistoryIndex` (so lowercasing/parsing happens once per snapshot, not per
/// keystroke) and returns ordered `RankedResult`s.
enum Ranking {

    // MARK: - Match tiers

    /// Fixed match-quality scores. Higher tier always wins over frecency, since
    /// `matchScore` multiplies `frecency` and the tier gaps dwarf the frecency
    /// range (frecency is roughly 0…4).
    enum MatchTier: Double {
        case hostPrefix        = 1000   // host (sans www) starts with query
        case hostContains      = 400    // host contains query
        case titleWordPrefix   = 300    // a title word starts with query
        case contains          = 150    // title or url contains query (anywhere)
        case fuzzyMax          = 100    // dense subsequence; scattered → down to ~10
    }

    // MARK: - Indexed snapshot

    /// A history page with its lowercased fields precomputed once per snapshot.
    struct IndexedPage {
        let item: HistoryItem
        let host: String        // lowercased, "www." stripped
        let path: String        // lowercased path (no query/fragment)
        let lowerTitle: String
        let lowerURL: String
        let frecency: Double     // frecency × recencyDecay, precomputed
    }

    /// An aggregated origin: one entry per host, summing its pages' signal.
    struct Origin {
        let host: String              // lowercased, "www." stripped
        let displayTitle: String      // e.g. "GitHub" or best root page title
        let url: String               // https://<host>
        let visitCount: Int
        let typedCount: Int
        let lastVisitTime: Double
        let frecency: Double          // frecency × recencyDecay for the origin
    }

    /// Precomputed snapshot the model rebuilds only when history changes.
    struct HistoryIndex {
        let pages: [IndexedPage]          // deduped by (host + path), best kept
        let origins: [Origin]             // aggregated by host
        let nowMs: Double

        static let empty = HistoryIndex(pages: [], origins: [], nowMs: 0)
    }

    /// A final, render-ready result. `isOrigin` lets the model label rows.
    struct RankedResult {
        let title: String
        let url: String
        let host: String
        let score: Double
        let isOrigin: Bool
    }

    // MARK: - Frecency / recency

    /// frecency = log10(1 + visitCount + 3·typedCount). Typed visits weigh more
    /// (the user deliberately went there). log10 compresses heavy-hitters so a
    /// site with 500 visits doesn't bury everything else.
    static func frecencyBase(visitCount: Int, typedCount: Int) -> Double {
        let raw = 1.0 + Double(visitCount) + 3.0 * Double(typedCount)
        return log10(raw)
    }

    /// recencyDecay = 0.5 ^ (ageDays / 30). Half-life of 30 days on
    /// lastVisitTime (Chrome epoch-milliseconds). Clamps to (0, 1].
    static func recencyDecay(lastVisitTime: Double, nowMs: Double) -> Double {
        let halfLifeDays = 30.0
        let msPerDay = 86_400_000.0
        let ageMs = max(0, nowMs - lastVisitTime)
        let ageDays = ageMs / msPerDay
        return pow(0.5, ageDays / halfLifeDays)
    }

    static func frecency(visitCount: Int, typedCount: Int, lastVisitTime: Double, nowMs: Double) -> Double {
        return frecencyBase(visitCount: visitCount, typedCount: typedCount)
             * recencyDecay(lastVisitTime: lastVisitTime, nowMs: nowMs)
    }

    // MARK: - Index building

    /// Build the per-snapshot index: parse hosts/paths once, dedupe pages, and
    /// aggregate origins. Called once when the history snapshot changes, NOT per
    /// keystroke.
    static func buildIndex(items: [HistoryItem], nowMs: Double = Date().timeIntervalSince1970 * 1000) -> HistoryIndex {
        // 1. Dedupe pages by (host + path): keep the single highest-frecency page
        //    so "…/posts?q=sys" / "?q=syst" / "?q=syste" collapse to one row.
        var bestByKey: [String: IndexedPage] = [:]
        // 2. Aggregate origins by host at the same time.
        var originAcc: [String: (visit: Int, typed: Int, last: Double, bestRootTitle: String, bestRootScore: Double)] = [:]

        for item in items {
            guard let (host, path) = hostAndPath(item.url), !host.isEmpty else { continue }
            let fr = frecency(visitCount: item.visitCount, typedCount: item.typedCount,
                              lastVisitTime: item.lastVisitTime, nowMs: nowMs)

            let page = IndexedPage(
                item: item,
                host: host,
                path: path,
                lowerTitle: item.title.lowercased(),
                lowerURL: item.url.lowercased(),
                frecency: fr
            )

            let key = host + "\u{1}" + path   // unlikely-collision separator
            if let existing = bestByKey[key] {
                if page.frecency > existing.frecency { bestByKey[key] = page }
            } else {
                bestByKey[key] = page
            }

            // Origin aggregation.
            var acc = originAcc[host] ?? (0, 0, 0, "", -1)
            acc.visit += item.visitCount
            acc.typed += item.typedCount
            acc.last = max(acc.last, item.lastVisitTime)
            // Prefer the title of the site ROOT (path "" or "/") as the origin
            // label; otherwise fall back to the highest-frecency page's title.
            let isRoot = (path.isEmpty || path == "/")
            let rootBias = isRoot ? 1_000_000.0 : 0.0
            let titleScore = fr + rootBias
            if !item.title.isEmpty && titleScore > acc.bestRootScore {
                acc.bestRootScore = titleScore
                acc.bestRootTitle = item.title
            }
            originAcc[host] = acc
        }

        let pages = Array(bestByKey.values)

        let origins: [Origin] = originAcc.map { (host, acc) in
            let fr = frecency(visitCount: acc.visit, typedCount: acc.typed,
                              lastVisitTime: acc.last, nowMs: nowMs)
            let display = acc.bestRootTitle.isEmpty ? capitalizedHost(host) : acc.bestRootTitle
            return Origin(
                host: host,
                displayTitle: display,
                url: "https://\(host)",
                visitCount: acc.visit,
                typedCount: acc.typed,
                lastVisitTime: acc.last,
                frecency: fr
            )
        }

        return HistoryIndex(pages: pages, origins: origins, nowMs: nowMs)
    }

    // MARK: - Ranking

    /// Rank for a query against a prebuilt index.
    ///
    /// Empty query → top-N origins/pages by frecency (handled by the caller via
    /// `topByFrecency`). Non-empty → tiered match × frecency, per-host capped.
    ///
    /// Returns results already ordered best-first. The TOP HIT (if any host
    /// prefixes the query) is guaranteed at index 0.
    static func rank(query rawQuery: String, index: HistoryIndex, limit: Int) -> [RankedResult] {
        let query = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if query.isEmpty {
            return topByFrecency(index: index, limit: limit)
        }

        var scored: [RankedResult] = []

        // --- Origins: the only source of the host-prefix top hit. ---
        for origin in index.origins {
            guard let tier = matchTier(query: query, host: origin.host,
                                       title: origin.displayTitle.lowercased(),
                                       url: origin.url.lowercased(),
                                       isOrigin: true) else { continue }
            scored.append(RankedResult(
                title: origin.displayTitle,
                url: origin.url,
                host: origin.host,
                score: tier * (origin.frecency + 0.1),
                isOrigin: true
            ))
        }

        // --- Pages. ---
        for page in index.pages {
            guard let tier = matchTier(query: query, host: page.host,
                                       title: page.lowerTitle, url: page.lowerURL,
                                       isOrigin: false) else { continue }
            let title = page.item.title.isEmpty ? page.item.url : page.item.title
            scored.append(RankedResult(
                title: title,
                url: page.item.url,
                host: page.host,
                score: tier * (page.frecency + 0.1),
                isOrigin: false
            ))
        }

        // Sort best-first. On score ties, prefer origins (cleaner rows).
        scored.sort { a, b in
            if a.score != b.score { return a.score > b.score }
            if a.isOrigin != b.isOrigin { return a.isOrigin }
            return a.title.count < b.title.count
        }

        // Dedupe identical URLs an origin+page can both produce (origin
        // "https://github.com" vs a page for the bare root). Keep first (best).
        scored = dedupeByURL(scored)

        // Cap per host to 3 so one chatty site can't flood the visible list.
        return capPerHost(scored, perHost: 3, limit: limit)
    }

    /// Empty-query listing: best origins and pages by pure frecency, per-host
    /// capped, origins preferred so the empty palette shows clean site rows.
    static func topByFrecency(index: HistoryIndex, limit: Int) -> [RankedResult] {
        var results: [RankedResult] = []
        for origin in index.origins {
            results.append(RankedResult(title: origin.displayTitle, url: origin.url,
                                        host: origin.host, score: origin.frecency,
                                        isOrigin: true))
        }
        results.sort { $0.score > $1.score }
        results = dedupeByURL(results)
        return capPerHost(results, perHost: 2, limit: limit)
    }

    // MARK: - Match tiering

    /// Return the best matching tier's score for a candidate, or nil if it does
    /// not match at all (→ excluded from results). Query is already lowercased.
    static func matchTier(query: String, host: String, title: String, url: String, isOrigin: Bool) -> Double? {
        // Tier 1: host prefix (sans www — host is already stripped).
        if host.hasPrefix(query) {
            return MatchTier.hostPrefix.rawValue
        }
        // Tier 2: host contains.
        if host.contains(query) {
            return MatchTier.hostContains.rawValue
        }
        // Tier 3: a title word starts with the query (word-boundary prefix).
        if titleWordPrefix(query: query, title: title) {
            return MatchTier.titleWordPrefix.rawValue
        }
        // Tier 4: plain substring in title or url.
        if title.contains(query) || url.contains(query) {
            return MatchTier.contains.rawValue
        }
        // Tier 5: dense fuzzy subsequence against the better of host/title/url.
        // Origins only get tiers 1–4 (a fuzzy host match is noise for a top hit).
        if isOrigin { return nil }
        let f1 = fuzzyDensity(query: query, text: title)
        let f2 = fuzzyDensity(query: query, text: url)
        if let best = maxOptional(f1, f2), best > 0 {
            return best
        }
        return nil
    }

    /// True if any word in `title` starts with `query`. Word boundaries are
    /// spaces and common separators.
    static func titleWordPrefix(query: String, title: String) -> Bool {
        guard !query.isEmpty, !title.isEmpty else { return false }
        if title.hasPrefix(query) { return true }
        let chars = Array(title)
        for i in 1..<chars.count where isBoundary(chars[i - 1]) {
            // Cheap suffix-prefix check without allocating a substring each time.
            if matchesAt(chars, start: i, query: query) { return true }
        }
        return false
    }

    private static func matchesAt(_ chars: [Character], start: Int, query: String) -> Bool {
        let q = Array(query)
        if start + q.count > chars.count { return false }
        for j in 0..<q.count where chars[start + j] != q[j] { return false }
        return true
    }

    /// Density-weighted fuzzy subsequence score in the range (0, ~100].
    /// Scattered matches (few consecutive runs, no word-boundary starts) score
    /// LOW; a tight consecutive match scores near `fuzzyMax`. Returns nil if the
    /// query is not a subsequence of the text at all.
    static func fuzzyDensity(query: String, text: String) -> Double? {
        if query.isEmpty { return 0 }
        let q = Array(query)
        let t = Array(text)
        if t.isEmpty { return nil }

        var qi = 0
        var raw = 0.0
        var prevMatchIndex = -2
        var consecutiveRun = 0
        var ti = 0
        while ti < t.count && qi < q.count {
            if t[ti] == q[qi] {
                raw += 1.0
                if ti == prevMatchIndex + 1 {
                    consecutiveRun += 1
                    raw += Double(consecutiveRun) * 1.5   // reward runs strongly
                } else {
                    consecutiveRun = 0
                }
                if ti == 0 || isBoundary(t[ti - 1]) {
                    raw += 2.0                              // word-boundary bonus
                }
                prevMatchIndex = ti
                qi += 1
            }
            ti += 1
        }
        if qi < q.count { return nil } // query not fully consumed → no match

        // Normalize into (10, fuzzyMax]. A perfectly consecutive, boundary-aligned
        // match of length n has raw ≈ n·(1 + boundary/run bonuses); a scattered
        // match has raw ≈ n. Divide by an "ideal dense" estimate to get density.
        let n = Double(q.count)
        let idealDense = n + (n - 1) * 1.5 + 2.0   // fully consecutive + one boundary
        let density = min(1.0, raw / max(1.0, idealDense))
        // Map density 0→~10, 1→fuzzyMax so even a weak subsequence ranks below
        // every "contains" match (tier 150) but is still shown if nothing better.
        return 10.0 + density * (MatchTier.fuzzyMax.rawValue - 10.0)
    }

    // MARK: - Post-processing

    private static func dedupeByURL(_ results: [RankedResult]) -> [RankedResult] {
        var seen = Set<String>()
        var out: [RankedResult] = []
        out.reserveCapacity(results.count)
        for r in results {
            let key = normalizeURLKey(r.url)
            if seen.insert(key).inserted { out.append(r) }
        }
        return out
    }

    private static func capPerHost(_ results: [RankedResult], perHost: Int, limit: Int) -> [RankedResult] {
        var perHostCount: [String: Int] = [:]
        var out: [RankedResult] = []
        for r in results {
            let c = perHostCount[r.host, default: 0]
            if c >= perHost { continue }
            perHostCount[r.host] = c + 1
            out.append(r)
            if out.count >= limit { break }
        }
        return out
    }

    // MARK: - URL parsing helpers

    /// Lowercased host (sans "www.") + lowercased path (no query/fragment).
    static func hostAndPath(_ urlString: String) -> (host: String, path: String)? {
        guard let comps = URLComponents(string: urlString), let rawHost = comps.host else {
            return nil
        }
        var host = rawHost.lowercased()
        if host.hasPrefix("www.") { host = String(host.dropFirst(4)) }
        var path = comps.path.lowercased()
        if path.count > 1 && path.hasSuffix("/") { path = String(path.dropLast()) }
        return (host, path)
    }

    /// Collapse trivial URL differences for dedupe (scheme, www, trailing slash).
    static func normalizeURLKey(_ urlString: String) -> String {
        guard let (host, path) = hostAndPath(urlString) else { return urlString.lowercased() }
        return host + (path.isEmpty ? "/" : path)
    }

    /// "github.com" → "Github", "news.ycombinator.com" → "News". Best-effort
    /// label when we have no page title for a host.
    static func capitalizedHost(_ host: String) -> String {
        let firstLabel = host.split(separator: ".").first.map(String.init) ?? host
        return firstLabel.prefix(1).uppercased() + String(firstLabel.dropFirst())
    }

    // MARK: - Small utilities

    private static func isBoundary(_ c: Character) -> Bool {
        return c == " " || c == "/" || c == "-" || c == "_" || c == "." ||
               c == ":" || c == "?" || c == "&" || c == "=" || c == "#"
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
