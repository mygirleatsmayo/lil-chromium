import Foundation
import LilShared

#if canImport(Glibc)
import Glibc
#else
import Darwin
#endif

/// Detect which Chromium-family browser launched this host by inspecting the
/// parent process's executable path. The immediate parent may be a Helper
/// process, but its path contains the browser's `.app` bundle path, so a
/// lowercased substring match resolves the browser. See docs/PROTOCOL.md and
/// research-v0.2.md §3.
enum BrowserDetect {

    /// Executable path for a pid via proc_pidpath(). nil on failure.
    static func executablePath(for pid: pid_t) -> String? {
        var buf = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        let n = proc_pidpath(pid, &buf, UInt32(MAXPATHLEN))
        guard n > 0 else { return nil }
        return String(cString: buf)
    }

    /// Substring match table, specific brands before generic Chrome/Chromium.
    /// The order matters: e.g. Brave/Edge helper paths must be checked before
    /// the generic "chrome" substrings.
    private static let matchers: [(slug: String, needles: [String])] = [
        ("helium",   ["helium.app/", "helium framework", "helium helper", "net.imput.helium"]),
        ("brave",    ["brave browser.app/", "brave browser helper", "bravesoftware"]),
        ("edge",     ["microsoft edge.app/", "microsoft edge helper"]),
        ("arc",      ["arc.app/"]),
        ("vivaldi",  ["vivaldi.app/"]),
        ("chrome",   ["google chrome.app/", "google chrome helper"]),
        ("chromium", ["chromium.app/", "chromium helper"]),
    ]

    /// Detect the parent browser slug. Returns "unknown" when no path is
    /// available or nothing matches.
    static func detectParentBrowser() -> String {
        let ppid = getppid()
        guard let path = executablePath(for: ppid) else { return "unknown" }
        let lower = path.lowercased()
        for m in matchers {
            if m.needles.contains(where: { lower.contains($0) }) {
                return m.slug
            }
        }
        return "unknown"
    }
}
