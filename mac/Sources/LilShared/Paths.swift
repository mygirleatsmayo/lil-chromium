import Foundation

/// Filesystem locations shared by the app and host.
public enum LilPaths {

    /// `$HOME/.lilchromium` — the state directory. Created 0700 by the host.
    public static var stateDir: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".lilchromium", isDirectory: true)
    }

    /// `$HOME/.lilchromium/relay.sock` — the app<->host unix domain socket.
    public static var socketPath: String {
        stateDir.appendingPathComponent("relay.sock").path
    }

    /// `$HOME/.lilchromium/host.log` — the host's small append log.
    public static var hostLogPath: String {
        stateDir.appendingPathComponent("host.log").path
    }

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
