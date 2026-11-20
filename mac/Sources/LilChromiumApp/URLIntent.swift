import Foundation
import LilShared

/// Interpreting raw palette/link input into a concrete URL and understanding
/// whether typed text looks like a URL.
enum URLIntent {

    /// What an incoming URL means at the app's routing boundary.
    /// Settings is classified first so it can never fall through to a lil open.
    enum Destination: Equatable {
        case settings
        case open(String)
    }

    static func destination(for urlString: String) -> Destination {
        if SettingsAction.matches(urlString) { return .settings }
        return .open(urlString)
    }

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

    /// The field text for a history URL, as Chrome's omnibox shows it on
    /// that row (`fill_into_edit`, `HistoryQuickProvider`): `FormatUrl` with
    /// `kFormatUrlOmitDefaults` and `UnescapeRule::SPACES`. It drops the
    /// username and password, `http://` (kept when a `typed` term matches at
    /// the URL's start, or the host starts with `ftp.`), and the `/` of a bare
    /// host unless dropping it changes whether the text reads as a URL
    /// (`FormattedStringWithEquivalentMeaning`). `%20` reads as a space;
    /// `https://` and `www.` stay. Unparseable URLs come back unchanged.
    static func fieldText(forHistoryURL url: String, typed: String) -> String {
        guard var parts = URLComponents(string: url), let host = parts.host, !host.isEmpty else {
            return url
        }
        parts.user = nil
        parts.password = nil
        let isBareHost = parts.percentEncodedPath == "/" && parts.query == nil && parts.fragment == nil
        if isBareHost { parts.percentEncodedPath = "" }
        guard var text = parts.string else { return url }

        let matchesInScheme = typed.split(whereSeparator: \.isWhitespace).contains {
            url.lowercased().hasPrefix($0.lowercased())
        }
        if parts.scheme?.lowercased() == "http", !host.lowercased().hasPrefix("ftp."), !matchesInScheme {
            text.removeFirst("http://".count)
        }
        if isBareHost, looksLikeURL(text) != looksLikeURL(text + "/") { text += "/" }
        return text.replacingOccurrences(of: "%20", with: " ")
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
