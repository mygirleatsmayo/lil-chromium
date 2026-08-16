import Foundation

/// Interpreting raw palette/link input into a concrete URL and understanding
/// whether typed text looks like a URL.
enum URLIntent {

    /// Does this text look like a URL the user meant to open directly?
    /// Rules (from PROTOCOL.md palette contract):
    ///   - has an explicit scheme (http://, https://, file://, etc.), OR
    ///   - has a dot and no spaces (e.g. "example.com", "sub.domain.co/path").
    static func looksLikeURL(_ raw: String) -> Bool {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return false }
        if text.contains(" ") { return false }

        // Explicit scheme?
        if let schemeRange = text.range(of: "://"), schemeRange.lowerBound != text.startIndex {
            return true
        }
        // Common single-word schemes without "//" (e.g. mailto:) are not our
        // job (we do not declare mailto), so ignore those.

        // Dot with no spaces, and at least one char on each side of a dot.
        if let dot = text.firstIndex(of: "."),
           dot != text.startIndex,
           text.index(after: dot) != text.endIndex {
            return true
        }
        return false
    }

    /// Normalize typed URL-ish text into an absolute URL string.
    /// Adds https:// when no scheme is present.
    static func normalizedURL(_ raw: String) -> String {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.range(of: "://") != nil {
            return text
        }
        return "https://\(text)"
    }

    /// A compact display host for a URL string (drops a leading "www."), for the
    /// search row subtitle. Nil if the string has no parseable host.
    static func hostForDisplay(_ urlString: String) -> String? {
        guard let host = URLComponents(string: urlString)?.host, !host.isEmpty else {
            return nil
        }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}
