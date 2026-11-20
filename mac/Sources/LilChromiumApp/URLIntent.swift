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

    /// What typed text names: nothing, a query to search for, or a URL to open.
    enum Intent: Equatable {
        case empty
        case search
        case open(String)

        var url: String? {
            if case .open(let url) = self { return url }
            return nil
        }
    }

    /// Reads typed text by the URL-intent contract (PROTOCOL.md *URL intent*);
    /// the first rule that matches wins. The hoverbar runs the same rules in
    /// `background.js`, except that `~` searches there.
    static func intent(
        of raw: String,
        home: String = FileManager.default.homeDirectoryForCurrentUser.path
    ) -> Intent {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return .empty }
        if namesScheme(text) || text.lowercased().hasPrefix("about:") {
            return .open(percentEncoded(text))
        }
        if text.hasPrefix("/") { return .open(percentEncoded("file://" + text)) }
        if text == "~" || text.hasPrefix("~/") {
            return .open(percentEncoded("file://" + home + text.dropFirst()))
        }
        if text.contains(where: \.isWhitespace) { return .search }
        if namesLocalHost(text) { return .open(percentEncoded("http://" + text)) }
        if text.dropFirst().dropLast().contains(".") { return .open(percentEncoded("https://" + text)) }
        return .search
    }

    /// Rule 2: the text starts with `scheme://`.
    private static func namesScheme(_ text: String) -> Bool {
        text.prefixMatch(of: #/[A-Za-z][A-Za-z0-9+.\-]*:\/\//#) != nil
    }

    /// Rule 7: the host is `localhost`, a `.localhost` name, a dotted IPv4
    /// address, or a single label with a numeric port (`devbox:8080`).
    private static func namesLocalHost(_ text: String) -> Bool {
        let authority = text.prefix { !"/?#".contains($0) }
        let parts = authority.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        let host = parts[0].lowercased()
        let port = parts.count > 1 ? parts[1] : nil
        let isDigits = { (s: Substring) in !s.isEmpty && s.allSatisfy { ("0"..."9").contains($0) } }
        if let port, !isDigits(port) { return false }
        if host == "localhost" || host.hasSuffix(".localhost") { return true }
        let octets = host.split(separator: ".", omittingEmptySubsequences: false)
        if octets.count == 4, octets.allSatisfy({ isDigits($0) && $0.count <= 3 && UInt8($0) != nil }) {
            return true
        }
        return port != nil && host.wholeMatch(of: #/[a-z0-9-]+/#) != nil
    }

    /// RFC 3986 unreserved and reserved characters, plus `%` so text that is
    /// already encoded stays as typed.
    private static let uriCharacters = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#[]@!$&'()*+,;=%"
    )

    /// Percent-encodes every other character (as UTF-8) so each consumer can
    /// parse the URL. Mirrors `percentEncoded` in `background.js`.
    private static func percentEncoded(_ url: String) -> String {
        url.addingPercentEncoding(withAllowedCharacters: uriCharacters) ?? url
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
        fieldText(for: url, typed: typed, trimmingAddedScheme: false)
    }

    /// The field text for an Open row, as Chrome's what-you-typed match shows
    /// it (`VerbatimMatchForInput`): formatted as for a history URL, less the
    /// `https://` or `http://` the resolver added when the typed text had no
    /// scheme (`AutocompleteProvider::TrimSchemePrefix`). Editing it resolves
    /// to the same URL again. `file://` stays, as Chrome trims only HTTP(S).
    static func fieldText(forOpenURL url: String, typed: String) -> String {
        let typedScheme = namesScheme(typed.trimmingCharacters(in: .whitespacesAndNewlines))
        return fieldText(for: url, typed: typed, trimmingAddedScheme: !typedScheme)
    }

    private static func fieldText(for url: String, typed: String, trimmingAddedScheme: Bool) -> String {
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
        let omitsScheme = switch parts.scheme?.lowercased() {
        case "http": trimmingAddedScheme || (!host.lowercased().hasPrefix("ftp.") && !matchesInScheme)
        case "https": trimmingAddedScheme
        default: false
        }
        if let scheme = parts.scheme, omitsScheme { text.removeFirst(scheme.count + "://".count) }
        if isBareHost, (intent(of: text).url == nil) != (intent(of: text + "/").url == nil) { text += "/" }
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
