import AppKit

/// Where a centered palette sits on a display, and how another window lines up
/// with it.
///
/// Shared by the palette itself and the Settings window so "near the centered
/// palette position" means exactly one thing in both places.
@MainActor
enum PalettePlacement {

    /// Fraction of a display's visible height between its top edge and the top
    /// edge of a centered palette. Matches PROTOCOL.md ("panel top at 20% of the
    /// display's visibleFrame height").
    static let topInsetFraction: CGFloat = 0.20

    /// AppKit Y (bottom-left origin) of the top edge of a centered palette.
    static func centeredTopEdgeY(on screen: NSScreen) -> CGFloat {
        let vf = screen.visibleFrame
        return vf.maxY - topInsetFraction * vf.height
    }

    /// Origin for a window of `size` that shares the centered palette's top edge
    /// and horizontal center on `screen`. Callers pass a fixed, known size, so
    /// the 20% top-edge rule holds unconditionally (no clamping).
    static func centeredOrigin(forSize size: CGSize, on screen: NSScreen) -> NSPoint {
        let vf = screen.visibleFrame
        let x = vf.minX + (vf.width - size.width) / 2
        let y = centeredTopEdgeY(on: screen) - size.height
        return NSPoint(x: x, y: y)
    }
}
