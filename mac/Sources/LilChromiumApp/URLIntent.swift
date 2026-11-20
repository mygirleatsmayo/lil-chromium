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
        if text.hasPrefix("/") { return .open(fileURL(path: text)) }
        if text == "~" || text.hasPrefix("~/") { return .open(fileURL(path: home + text.dropFirst())) }
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

    /// Rules 4 and 5: the `file://` URL for the file at exactly `path`, as
    /// Chrome's `FilePathToFileURL` builds it (`net/base/filename_util.cc`):
    /// `%`, `;`, `#` and `?` are escaped too, so they stay part of the file
    /// name. Mirrors `fileURL` in `background.js`.
    private static func fileURL(path: String) -> String {
        "file://" + (path.addingPercentEncoding(withAllowedCharacters: filePathCharacters) ?? path)
    }

    private static let filePathCharacters = uriCharacters.subtracting(CharacterSet(charactersIn: "%;#?"))

    /// The field text for a history URL, as Chrome's omnibox shows it on
    /// that row (`fill_into_edit`, `HistoryQuickProvider`): `FormatUrl` with
    /// `kFormatUrlOmitDefaults` and `UnescapeRule::SPACES`. It drops the
    /// username and password, `http://` (kept when a `typed` term matches at
    /// the URL's start, or the host starts with `ftp.`), and the `/` of a bare
    /// host unless dropping it changes whether the text reads as a URL
    /// (`FormattedStringWithEquivalentMeaning`). Percent-escapes decode as
    /// `unescaped(_:)` says; `https://`, `www.` and the ASCII host stay.
    /// Unparseable URLs come back unchanged.
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
        // verified: `URLComponents` gives `file:///…` an empty host, not nil.
        guard var parts = URLComponents(string: url), let host = parts.host else { return url }
        parts.user = nil
        parts.password = nil
        let isBareHost = !host.isEmpty && parts.percentEncodedPath == "/" && parts.query == nil && parts.fragment == nil
        if isBareHost { parts.percentEncodedPath = "" }

        // Each non-host component decodes on its own (`NonHostComponentTransform`).
        let (path, query, fragment) = (parts.percentEncodedPath, parts.percentEncodedQuery, parts.percentEncodedFragment)
        parts.percentEncodedPath = ""
        parts.percentEncodedQuery = nil
        parts.percentEncodedFragment = nil
        guard var text = parts.string else { return url }
        text += unescaped(path)
        if let query { text += "?" + unescaped(query) }
        if let fragment { text += "#" + unescaped(fragment) }

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
        return text
    }

    /// One URL component with its percent-escapes decoded, as Chrome's
    /// `UnescapeAndDecodeUTF8URLComponentWithAdjustments` does with
    /// `UnescapeRule::SPACES` (`base/strings/escape.cc`). Each escape decodes
    /// with the UTF-8 continuation escapes that follow it; one that
    /// `isUnescapable(_:)` rejects stays as written. A component with an escape
    /// that isn't UTF-8 stays escaped, as Chrome's decode of it fails.
    private static func unescaped(_ component: String) -> String {
        let bytes = Array(component.utf8)
        func escapedByte(at i: Int) -> UInt8? {
            guard i + 2 < bytes.count, bytes[i] == UInt8(ascii: "%") else { return nil }
            let hex = bytes[i + 1...i + 2]
            guard hex.allSatisfy({ Character(Unicode.Scalar($0)).isHexDigit }) else { return nil }
            return UInt8(String(decoding: hex, as: UTF8.self), radix: 16)
        }
        var decoded: [UInt8] = []
        var i = 0
        while i < bytes.count {
            guard let lead = escapedByte(at: i) else {
                decoded.append(bytes[i])
                i += 1
                continue
            }
            var run = [lead]
            if (0xC2...0xF4).contains(lead) {  // a UTF-8 lead byte (`CBU8_IS_LEAD`)
                while run.count < 4, let next = escapedByte(at: i + 3 * run.count), next & 0xC0 == 0x80 {
                    run.append(next)
                }
            }
            var iterator = run.makeIterator()
            var decoder = UTF8()
            guard case .scalarValue(let scalar) = decoder.decode(&iterator) else { return component }
            let width = UTF8.width(scalar)
            decoded += isUnescapable(scalar) ? run.prefix(width) : bytes[i..<i + 3 * width]
            i += 3 * width
        }
        return String(decoding: decoded, as: UTF8.self)
    }

    /// Whether Chrome decodes an escaped character (`ShouldUnescapeCodePoint`):
    /// space and the ASCII characters in `kUrlUnescape`, which can't change
    /// how the URL parses, or any other character but `spoofingCodePoints`.
    private static func isUnescapable(_ scalar: Unicode.Scalar) -> Bool {
        if scalar.isASCII {
            return CharacterSet.alphanumerics.contains(scalar) || " \"-<>_~".unicodeScalars.contains(scalar)
        }
        return !spoofingCodePoints.contains { $0.contains(scalar.value) }
    }

    /// Characters Chrome keeps escaped because they can disguise a URL or
    /// imitate browser UI (`ShouldUnescapeCodePoint`): BiDi controls, lock
    /// emoji, characters that render as spaces, and default-ignorable and
    /// format characters.
    private static let spoofingCodePoints: [ClosedRange<UInt32>] = [
        0x0085...0x0085, 0x00A0...0x00A0, 0x00AD...0x00AD, 0x034F...0x034F,
        0x0600...0x0605, 0x061C...0x061C, 0x06DD...0x06DD, 0x070F...0x070F,
        0x08E2...0x08E2, 0x115F...0x1160, 0x1680...0x1680, 0x17B4...0x17B5,
        0x180B...0x180E, 0x2000...0x200F, 0x2028...0x202F, 0x205F...0x206F,
        0x2800...0x2800, 0x3000...0x3000, 0x3164...0x3164, 0xFE00...0xFE0F,
        0xFEFF...0xFEFF, 0xFFA0...0xFFA0, 0xFFF0...0xFFFB, 0x110BD...0x110BD,
        0x110CD...0x110CD, 0x13430...0x13438, 0x1BCA0...0x1BCA3, 0x1D173...0x1D17A,
        0x1F50F...0x1F510, 0x1F512...0x1F513, 0xE0000...0xE0FFF,
    ]

    /// A compact display host for a URL string (drops a leading "www."), for the
    /// search row subtitle. Nil if the string has no parseable host.
    static func hostForDisplay(_ urlString: String) -> String? {
        guard let host = URLComponents(string: urlString)?.host, !host.isEmpty else {
            return nil
        }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}
