import Foundation
import LilShared

#if canImport(Glibc)
import Glibc
#else
import Darwin
#endif

/// Detect which catalogued browser installation launched this host by
/// inspecting the parent process's executable path. The immediate parent may
/// be a Helper process, but its path contains the browser's `.app` bundle
/// path, so a lowercased substring match against `BrowserTable` resolves the
/// installation. See docs/PROTOCOL.md.
enum BrowserDetect {

    /// Executable path for a pid via proc_pidpath(). nil on failure.
    static func executablePath(for pid: pid_t) -> String? {
        var buf = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        let n = proc_pidpath(pid, &buf, UInt32(MAXPATHLEN))
        guard n > 0 else { return nil }
        return String(cString: buf)
    }

    /// Detect the parent browser slug. Returns "unknown" when no path is
    /// available or nothing in the catalog matches.
    static func detectParentBrowser() -> String {
        let ppid = getppid()
        guard let path = executablePath(for: ppid) else { return "unknown" }
        return BrowserTable.slug(matchingExecutablePath: path)
    }
}
