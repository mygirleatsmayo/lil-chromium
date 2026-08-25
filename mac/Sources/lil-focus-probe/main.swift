import AppKit
import LilFocusProbe

// LILFOCUS — `lil-focus-probe [label]`
//
// Prints one JSON snapshot of the frontmost application and every ordinary
// on-screen window in front-to-back order. Diagnostic tooling for issue #30's
// real-Mac focus loop; not part of the shipping app bundle.
//
// verified: CGWindowListCopyWindowInfo returns window number, owner pid, layer,
// and bounds without Accessibility or Screen Recording permission (only the
// optional window *title* is gated, and this probe never reads it). Public API
// only — see docs/PROTOCOL.md's activation note.

/// CoreGraphics reports bounds in a global space whose origin is the top-left
/// of the primary display. NSScreen frames use AppKit's bottom-left origin, so
/// display frames are flipped into the window space before comparison.
func probeDisplays() -> [ProbeDisplay] {
    let screens = NSScreen.screens
    let primary = screens.first(where: { $0.frame.origin == .zero }) ?? screens.first
    let primaryHeight = primary?.frame.height ?? 0
    return screens.enumerated().map { index, screen in
        let f = screen.frame
        return ProbeDisplay(
            index: index,
            frame: ProbeRect(
                x: f.minX,
                y: primaryHeight - f.maxY,
                w: f.width,
                h: f.height
            ),
            isPrimary: f.origin == .zero
        )
    }
}

func rawWindows() -> [RawProbeWindow] {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    let listing = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
    return listing.compactMap { entry in
        guard
            let number = entry[kCGWindowNumber as String] as? Int,
            let pid = entry[kCGWindowOwnerPID as String] as? Int,
            let layer = entry[kCGWindowLayer as String] as? Int,
            let bounds = entry[kCGWindowBounds as String] as? [String: Any]
        else { return nil }
        func value(_ key: String) -> Double { (bounds[key] as? NSNumber)?.doubleValue ?? 0 }
        return RawProbeWindow(
            number: number,
            pid: pid,
            owner: entry[kCGWindowOwnerName as String] as? String ?? "",
            layer: layer,
            bounds: ProbeRect(x: value("X"), y: value("Y"), w: value("Width"), h: value("Height"))
        )
    }
}

/// Bundle identifiers for exactly the processes that own a listed window.
func bundleIds(for windows: [RawProbeWindow]) -> [Int: String] {
    var map: [Int: String] = [:]
    for pid in Set(windows.map(\.pid)) {
        if let bundleId = NSRunningApplication(processIdentifier: pid_t(pid))?.bundleIdentifier {
            map[pid] = bundleId
        }
    }
    return map
}

func frontmostApp() -> ProbeApp? {
    guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
    return ProbeApp(
        pid: Int(app.processIdentifier),
        bundleId: app.bundleIdentifier,
        name: app.localizedName
    )
}

let label = CommandLine.arguments.dropFirst().first ?? "probe"
let windows = rawWindows()
let snapshot = FocusProbe.snapshot(
    windows: windows,
    displays: probeDisplays(),
    bundleIds: bundleIds(for: windows),
    frontmost: frontmostApp(),
    label: label,
    now: Date().timeIntervalSince1970 * 1000
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
guard let data = try? encoder.encode(snapshot), let json = String(data: data, encoding: .utf8) else {
    FileHandle.standardError.write(Data("lil-focus-probe: failed to encode snapshot\n".utf8))
    exit(1)
}
print(json)
