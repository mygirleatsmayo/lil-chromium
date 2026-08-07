import Foundation

/// Filesystem locations shared by the app and host.
public enum LilPaths {

    /// `$HOME/.lilchromium` — the state directory. Created 0700 by the host.
    public static var stateDir: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".lilchromium", isDirectory: true)
    }

    // MARK: - Per-browser sockets (v2)

    /// `$HOME/.lilchromium/relay-<slug>.sock` — the app<->host unix domain
    /// socket for a specific browser. Each host binds its own browser's socket.
    public static func socketURL(forBrowser slug: String) -> URL {
        stateDir.appendingPathComponent("relay-\(slug).sock", isDirectory: false)
    }

    /// Convenience: filesystem path string for a browser's socket.
    public static func socketPath(forBrowser slug: String) -> String {
        socketURL(forBrowser: slug).path
    }

    /// `$HOME/.lilchromium/host-<slug>.log` — a host's per-browser log file.
    public static func hostLogPath(forBrowser slug: String) -> String {
        stateDir.appendingPathComponent("host-\(slug).log", isDirectory: false).path
    }

    /// All present `relay-*.sock` files, newest mtime first, paired with the
    /// slug extracted from the filename (`relay-<slug>.sock`). Used by the app
    /// to route to any live host when the preferred ones are absent.
    public static func allSocketURLs() -> [(slug: String, url: URL)] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: stateDir,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }

        var results: [(slug: String, url: URL, mtime: Date)] = []
        for url in entries {
            let name = url.lastPathComponent
            guard name.hasPrefix("relay-"), name.hasSuffix(".sock") else { continue }
            // Extract "<slug>" from "relay-<slug>.sock".
            let start = name.index(name.startIndex, offsetBy: "relay-".count)
            let end = name.index(name.endIndex, offsetBy: -".sock".count)
            guard start < end else { continue }
            let slug = String(name[start..<end])

            let mtime = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? .distantPast
            results.append((slug: slug, url: url, mtime: mtime))
        }

        return results
            .sorted { $0.mtime > $1.mtime }
            .map { (slug: $0.slug, url: $0.url) }
    }

    // MARK: - State dir

    /// Ensure the state directory exists with 0700 permissions.
    @discardableResult
    public static func ensureStateDir() -> Bool {
        let fm = FileManager.default
        let dir = stateDir
        do {
            if !fm.fileExists(atPath: dir.path) {
                try fm.createDirectory(
                    at: dir,
                    withIntermediateDirectories: true,
                    attributes: [.posixPermissions: 0o700]
                )
            }
            return true
        } catch {
            return false
        }
    }
}
