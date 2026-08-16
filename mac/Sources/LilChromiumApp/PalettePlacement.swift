import AppKit

/// Where a centered palette sits on a display, and how another window lines up
/// with it.
///
/// Shared by the palette itself and the Settings window so "near the centered
/// palette position" means exactly one thing in both places.
enum PalettePlacement {

    /// Fraction of a display's visible height between its top edge and the top
    /// edge of a centered palette. Matches PROTOCOL.md ("panel top at 20% of the
    /// display's visibleFrame height").
    static let topInsetFraction: CGFloat = 0.20

    /// The display the user is working on: the one under the pointer, falling
    /// back to `NSScreen.main`. A menu-bar agent usually has no key window when
    /// the user reaches for Settings, which makes `NSScreen.main` alone an
    /// unreliable answer on a multi-display desk.
    static var activeScreen: NSScreen? {
        let mouse = NSEvent.mouseLocation
        return NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
    }

    /// AppKit Y (bottom-left origin) of the top edge of a centered palette.
    static func centeredTopEdgeY(on screen: NSScreen) -> CGFloat {
        let vf = screen.visibleFrame
        return vf.maxY - topInsetFraction * vf.height
    }

    /// Origin for a window of `size` that shares the centered palette's top edge
    /// and horizontal center on `screen`. A window taller than the space below
    /// that top edge is nudged up so it stays fully on screen.
    static func centeredOrigin(forSize size: CGSize, on screen: NSScreen) -> NSPoint {
        let vf = screen.visibleFrame
        let x = vf.minX + (vf.width - size.width) / 2
        let y = centeredTopEdgeY(on: screen) - size.height
        return NSPoint(x: x, y: max(y, vf.minY))
    }
}
