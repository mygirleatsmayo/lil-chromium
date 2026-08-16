import AppKit
import Foundation
import LilShared

/// Decides how to open a URL: over the relay (preferred) or by launching a
/// browser directly (fallback). Also owns the AppKit->Chrome coordinate
/// conversion.
///
/// PROTOCOL.md coordinates:
///   AppKit: origin bottom-left of primary screen, Y up.
///   Chrome: origin top-left of primary screen, Y down.
///   chromeY = primaryScreen.frame.height - appKitY. Only the Y flip is needed;
///   the global desktop space is otherwise shared.
enum OpenRouter {

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
    /// to the panel's position). Relay-first with Chrome fallback. `incognito`
    /// (palette ⌘-Enter) is carried on the relay `open` message; the direct-
    /// launch fallback cannot honor it (no extension in the loop), so an
    /// incognito open that finds no relay degrades to a normal browser launch.
    static func open(_ urlString: String, left: Int, top: Int, incognito: Bool = false) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try RelayClient.sendOpen(url: urlString, left: left, top: top, incognito: incognito)
                // Success: the host is up. (If the extension port were down the
                // host queues the open per PROTOCOL.md, so a successful socket
                // write is sufficient — no separate ping needed on the hot path.)
                return
            } catch {
                // Relay down: fall back to launching a browser directly.
                DispatchQueue.main.async {
                    fallbackOpenInBrowser(urlString)
                }
            }
        }
    }

    /// Fallback when no relay answered: launch the URL in a real browser by
    /// bundle id, in order — config defaultBrowser, then fallbackBrowser, then
    /// the first installed known browser. NEVER `NSWorkspace.shared.open(url)`
    /// bare: this app IS the system default HTTP handler, so a bare open would
    /// route straight back to us (infinite loop). If nothing can be launched
    /// the link is dropped (logged) rather than looping.
    static func fallbackOpenInBrowser(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        openFirstAvailable(url, bundleIds: launchBundleIds(config: .load()), ws: NSWorkspace.shared)
    }

    /// The ordered launch candidates for a config snapshot (PROTOCOL.md routing
    /// steps 4–5): primary browser, fallback browser, then every installed known
    /// browser. Deduped; slugs with no known bundle id drop out.
    static func launchBundleIds(config cfg: LilConfig) -> [String] {
        var candidates: [String] = []
        func append(_ bundleId: String?) {
            guard let bid = bundleId, !bid.isEmpty, !candidates.contains(bid) else { return }
            candidates.append(bid)
        }
        func appendBundleId(forSlug slug: String) {
            guard !slug.isEmpty else { return }
            // Prefer the config's recorded bundle id; fall back to the table.
            append(cfg.knownBrowsers.first(where: { $0.slug == slug })?.bundleId
                ?? BrowserTable.bundleId(forSlug: slug))
        }
        appendBundleId(forSlug: cfg.defaultBrowser)
        appendBundleId(forSlug: cfg.fallbackBrowser)
        // Then any installed known browser from the config scan.
        for kb in cfg.knownBrowsers where kb.installed { append(kb.bundleId) }
        return candidates
    }

    /// Try each bundle id in order; launch with the first one Launch Services
    /// can resolve. Recurses to the next candidate on launch error so we never
    /// bare-open (which would loop back into this app).
    private static func openFirstAvailable(_ url: URL, bundleIds: [String], ws: NSWorkspace) {
        guard let bundleId = bundleIds.first else {
            NSLog("lil-chromium: fallback found no launchable browser for \(url.absoluteString)")
            return
        }
        let rest = Array(bundleIds.dropFirst())

        guard let appURL = ws.urlForApplication(withBundleIdentifier: bundleId) else {
            openFirstAvailable(url, bundleIds: rest, ws: ws)
            return
        }

        let config = NSWorkspace.OpenConfiguration()
        config.activates = true
        ws.open([url], withApplicationAt: appURL, configuration: config) { _, error in
            if error != nil {
                DispatchQueue.main.async {
                    openFirstAvailable(url, bundleIds: rest, ws: ws)
                }
            }
        }
    }
}
