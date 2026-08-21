import Foundation

/// Lil Chromium's dedicated native Settings action.
///
/// The extension asks the host to open Settings (`open-settings`). The host
/// launches this URL targeted at Lil Chromium's bundle id — never at a
/// browser. The app recognizes the same URL before ordinary HTTP/HTTPS routing
/// and presents the singleton Settings window.
public enum SettingsAction {
    public static let urlString = "lilchromium://settings"
    public static let bundleId = "com.lilchromium.app"
    public static let scheme = "lilchromium"
    public static let host = "settings"

    /// `/usr/bin/open` arguments that target Lil Chromium specifically.
    public static var openArguments: [String] {
        ["-b", bundleId, urlString]
    }

    /// True for palette queries that should surface the Settings result:
    /// the complete case-insensitive words “settings” or “preferences”.
    public static func matchesQuery(_ raw: String) -> Bool {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return text == "settings" || text == "preferences"
    }

    /// True only for the dedicated Settings URL (`lilchromium://settings`),
    /// not for HTTP(S) or any other scheme/host.
    public static func matches(_ raw: String) -> Bool {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: text),
              let scheme = components.scheme,
              scheme.caseInsensitiveCompare(Self.scheme) == .orderedSame else {
            return false
        }
        let host = (components.host ?? "").lowercased()
        guard host == Self.host else { return false }
        return components.path.isEmpty || components.path == "/"
    }
}
