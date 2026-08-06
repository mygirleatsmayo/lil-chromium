import AppKit
import Foundation

/// Decides how to open a URL: over the relay (preferred) or via Chrome directly
/// (fallback). Also owns the AppKit->Chrome coordinate conversion.
///
/// PROTOCOL.md coordinates:
///   AppKit: origin bottom-left of primary screen, Y up.
///   Chrome: origin top-left of primary screen, Y down.
///   chromeY = primaryScreen.frame.height - appKitY. Only the Y flip is needed;
///   the global desktop space is otherwise shared.
enum OpenRouter {

    static let chromeBundleID = "com.google.Chrome"

    /// The primary screen (the one whose frame origin is (0,0)), falling back to
    /// NSScreen.main. Used for the Y flip and for palette anchoring.
    static var primaryScreen: NSScreen? {
        NSScreen.screens.first(where: { $0.frame.origin == .zero }) ?? NSScreen.main
    }

    /// Convert an AppKit global point (bottom-left origin) into Chrome window
    /// top-left coordinates (top-left origin), offset so the cursor sits ~40pt
    /// inside the window's top-left, clamped to that display's visible frame.
    ///
    /// The extension applies remembered size and does the final full-on-screen
    /// clamp; we just provide a sensible suggested top-left.
    static func chromeTopLeft(fromMouse mouse: NSPoint) -> (left: Int, top: Int) {
        let primaryHeight = primaryScreen?.frame.height ?? mouse.y
        let chromeY = primaryHeight - mouse.y

        var left = mouse.x - 60
        var top = chromeY - 40

        // Light clamp to the visible frame of the display under the cursor so we
        // never suggest an off-screen origin. Convert the display's AppKit
        // visibleFrame into Chrome-space for the clamp.
        if let screen = screenContaining(point: mouse) ?? primaryScreen {
            let vf = screen.visibleFrame
            // Chrome-space X range is the same as AppKit X (no flip on X).
            let minX = vf.minX
            let maxX = vf.maxX - 40 // keep a sliver on-screen
            left = min(max(left, minX), maxX)

            // Chrome-space Y for the visibleFrame: top edge maps to
            // primaryHeight - vf.maxY, bottom edge to primaryHeight - vf.minY.
            let minTop = primaryHeight - vf.maxY
            let maxTop = primaryHeight - vf.minY - 40
            top = min(max(top, minTop), maxTop)
        }

        return (Int(left.rounded()), Int(top.rounded()))
    }

    private static func screenContaining(point: NSPoint) -> NSScreen? {
        NSScreen.screens.first(where: { NSMouseInRect(point, $0.frame, false) })
    }

    /// Open a URL with mouse-anchored coordinates. Tries the relay first; on any
    /// failure OR when the extension is not connected, falls back to Chrome.
    /// Never drops the link.
    ///
    /// Runs its network work off the main thread. Safe to call from the main
    /// queue (URL intake, palette Enter).
    static func openAnchoredToMouse(_ urlString: String) {
        let mouse = NSEvent.mouseLocation
        let coords = chromeTopLeft(fromMouse: mouse)
        open(urlString, left: coords.left, top: coords.top)
    }

    /// Open a URL at explicit Chrome coordinates (used by the palette, anchored
    /// to the panel's position). Relay-first with Chrome fallback.
    static func open(_ urlString: String, left: Int, top: Int) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try RelayClient.sendOpen(url: urlString, left: left, top: top)
                // Success: the host is up. (If the extension port were down the
                // host queues the open per PROTOCOL.md, so a successful socket
                // write is sufficient — no separate ping needed on the hot path.)
                return
            } catch {
                // Relay down: fall back to Chrome directly.
                DispatchQueue.main.async {
                    fallbackOpenInChrome(urlString)
                }
            }
        }
    }

    /// Fallback: open the URL in Chrome via NSWorkspace; if Chrome is missing,
    /// open with the system default handler (which is us — but at that point the
    /// relay was already down, so this hands off to whatever else can open it).
    static func fallbackOpenInChrome(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }

        let ws = NSWorkspace.shared
        if let chromeURL = ws.urlForApplication(withBundleIdentifier: chromeBundleID) {
            let config = NSWorkspace.OpenConfiguration()
            config.activates = true
            ws.open([url], withApplicationAt: chromeURL, configuration: config) { _, error in
                if error != nil {
                    // Last resort so we never drop the link.
                    DispatchQueue.main.async { _ = ws.open(url) }
                }
            }
        } else {
            // Chrome missing entirely.
            _ = ws.open(url)
        }
    }
}
