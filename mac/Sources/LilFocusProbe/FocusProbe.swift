import Foundation

// LILFOCUS — diagnostic-only module for issue #30's real-Mac focus loop.
//
// This target is NOT part of the shipping app: `scripts/bundle-app.sh` copies
// only LilChromiumApp and lilchromium-host into the bundle. Nothing in the
// product links against it.
//
// It turns one raw CGWindowList reading into a machine-comparable snapshot:
// the frontmost application plus every ordinary on-screen window in
// front-to-back order. That ordering is the oracle the harness needs, because
// the #30 symptom "an unrelated Helium sibling rose" is a z-order change that
// no Chromium API can observe.
//
// Everything here is pure so it can be tested without a window server; the
// executable target owns the AppKit/CoreGraphics reading.

/// A rectangle in CoreGraphics global screen space (origin top-left, Y down).
public struct ProbeRect: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double

    public init(x: Double, y: Double, w: Double, h: Double) {
        self.x = x
        self.y = y
        self.w = w
        self.h = h
    }

    var center: (x: Double, y: Double) { (x + w / 2, y + h / 2) }

    func contains(x px: Double, y py: Double) -> Bool {
        px >= x && px < x + w && py >= y && py < y + h
    }
}

/// One window as CoreGraphics reports it, before filtering or enrichment.
public struct RawProbeWindow: Sendable {
    public var number: Int
    public var pid: Int
    public var owner: String
    public var layer: Int
    public var bounds: ProbeRect

    public init(number: Int, pid: Int, owner: String, layer: Int, bounds: ProbeRect) {
        self.number = number
        self.pid = pid
        self.owner = owner
        self.layer = layer
        self.bounds = bounds
    }
}

/// A display, in the same CoreGraphics space as window bounds.
public struct ProbeDisplay: Codable, Equatable, Sendable {
    public var index: Int
    public var frame: ProbeRect
    public var isPrimary: Bool

    public init(index: Int, frame: ProbeRect, isPrimary: Bool) {
        self.index = index
        self.frame = frame
        self.isPrimary = isPrimary
    }
}

/// The frontmost application at reading time.
public struct ProbeApp: Codable, Equatable, Sendable {
    public var pid: Int
    public var bundleId: String?
    public var name: String?

    public init(pid: Int, bundleId: String?, name: String?) {
        self.pid = pid
        self.bundleId = bundleId
        self.name = name
    }
}

/// One ordinary window, enriched with its stacking position and display.
public struct ProbeWindow: Codable, Equatable, Sendable {
    /// Front-to-back position among ordinary windows: 0 is frontmost.
    public var order: Int
    public var number: Int
    public var pid: Int
    public var bundleId: String?
    public var owner: String
    public var bounds: ProbeRect
    /// Index of the display holding the window's center, or nil when off every
    /// known display (minimized/offscreen).
    public var display: Int?
}

public struct ProbeSnapshot: Codable, Equatable, Sendable {
    public var tag: String
    public var source: String
    public var t: Double
    public var label: String
    public var frontmost: ProbeApp?
    public var displays: [ProbeDisplay]
    public var windows: [ProbeWindow]
}

public enum FocusProbe {
    /// The tag every #30 diagnostic record carries, so one grep finds the seam.
    public static let tag = "LILFOCUS"

    /// CoreGraphics window layer for ordinary application windows. Menus,
    /// status items, shades, and the cursor live on other layers and are noise
    /// for a z-order oracle.
    public static let ordinaryLayer = 0

    /// Build a comparable snapshot from one raw reading.
    ///
    /// - Parameters:
    ///   - windows: raw windows in CoreGraphics' own front-to-back order.
    ///   - displays: display frames in the same coordinate space.
    ///   - bundleIds: pid -> bundle identifier for the processes seen.
    ///   - frontmost: the frontmost application, if any.
    ///   - label: caller-supplied name for this reading (e.g. "afterClose").
    ///   - now: reading time, epoch milliseconds.
    public static func snapshot(
        windows: [RawProbeWindow],
        displays: [ProbeDisplay],
        bundleIds: [Int: String],
        frontmost: ProbeApp?,
        label: String,
        now: Double
    ) -> ProbeSnapshot {
        let ordinary = windows.filter { $0.layer == ordinaryLayer }
        let enriched = ordinary.enumerated().map { index, win in
            ProbeWindow(
                order: index,
                number: win.number,
                pid: win.pid,
                bundleId: bundleIds[win.pid],
                owner: win.owner,
                bounds: win.bounds,
                display: displayIndex(of: win.bounds, in: displays)
            )
        }
        return ProbeSnapshot(
            tag: tag,
            source: "probe",
            t: now,
            label: label,
            frontmost: frontmost,
            displays: displays,
            windows: enriched
        )
    }

    /// The display whose frame holds the rect's center; nil when none does.
    static func displayIndex(of rect: ProbeRect, in displays: [ProbeDisplay]) -> Int? {
        let c = rect.center
        return displays.first(where: { $0.frame.contains(x: c.x, y: c.y) })?.index
    }
}
