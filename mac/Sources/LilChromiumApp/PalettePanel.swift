import AppKit

/// The palette window: a borderless, non-activating panel with a Liquid Glass
/// background (macOS 26+) and a NSVisualEffectView fallback for macOS 13–25.
///
/// Dismissal policy (v0.2): the panel closes ONLY on Esc, the ⌘⌥N toggle, the X
/// button, or opening a result — NEVER on resignKey / app deactivation, so the
/// user can hop to Raycast / a pasteboard manager and come back with the palette
/// still up. Accordingly this panel has NO windowDidResignKey handler and
/// `hidesOnDeactivate = false`.
///
/// It CAN become key (so the search field is typeable) without activating the
/// app, via `.nonactivatingPanel` + `canBecomeKey = true` + orderFrontRegardless.
final class PalettePanel: NSPanel {

    /// The controller owns close(); we forward Esc to it.
    weak var paletteDelegate: PaletteController?

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    /// Esc at the panel level (also reached from the search field's
    /// cancelOperation which returns false and lets this fire). Closes.
    override func cancelOperation(_ sender: Any?) {
        paletteDelegate?.close()
    }
}

/// Builds the glass (or fallback) container view holding the palette content.
/// Kept separate so PaletteController stays focused on data flow.
enum PaletteGlass {

    /// Corner radius for the panel and the glass/mask.
    static let cornerRadius: CGFloat = 20

    /// Wrap `content` in a Liquid Glass container on macOS 26+, else a rounded
    /// NSVisualEffectView. `content` is pinned to fill either container.
    ///
    /// Returns the container view to assign as the panel's contentView. The
    /// window's `backgroundColor` MUST be `.clear` for the glass to show through
    /// (the caller sets that).
    static func makeContainer(content: NSView) -> NSView {
        content.translatesAutoresizingMaskIntoConstraints = false

        if #available(macOS 26.0, *) {
            let glass = NSGlassEffectView()
            glass.cornerRadius = cornerRadius
            glass.clipsToBounds = true
            // Only `contentView` is guaranteed to render inside the glass — do
            // not addSubview directly (per research note).
            glass.contentView = content
            return glass
        } else {
            // Fallback: rounded corners on NSVisualEffectView REQUIRE a
            // maskImage — layer.cornerRadius does not clip the vibrancy blur.
            let vfx = NSVisualEffectView()
            vfx.blendingMode = .behindWindow
            vfx.state = .active
            vfx.material = .hudWindow
            vfx.maskImage = roundedMask(cornerRadius: cornerRadius)
            vfx.addSubview(content)
            NSLayoutConstraint.activate([
                content.leadingAnchor.constraint(equalTo: vfx.leadingAnchor),
                content.trailingAnchor.constraint(equalTo: vfx.trailingAnchor),
                content.topAnchor.constraint(equalTo: vfx.topAnchor),
                content.bottomAnchor.constraint(equalTo: vfx.bottomAnchor)
            ])
            return vfx
        }
    }

    /// A stretchable rounded-rect mask image (black fill = opaque) for the
    /// fallback visual-effect view.
    private static func roundedMask(cornerRadius r: CGFloat) -> NSImage {
        let img = NSImage(size: NSSize(width: r * 2, height: r * 2), flipped: false) { rect in
            NSColor.black.set()
            NSBezierPath(roundedRect: rect, xRadius: r, yRadius: r).fill()
            return true
        }
        img.capInsets = NSEdgeInsets(top: r, left: r, bottom: r, right: r)
        img.resizingMode = .stretch
        return img
    }
}

/// A thin overlay view that draws a 1px hairline border on top of the glass, so
/// the panel edge reads crisply against light backgrounds. Transparent fill.
final class HairlineBorderView: NSView {
    var cornerRadius: CGFloat = PaletteGlass.cornerRadius

    override var isFlipped: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        let inset = bounds.insetBy(dx: 0.5, dy: 0.5)
        let path = NSBezierPath(roundedRect: inset, xRadius: cornerRadius, yRadius: cornerRadius)
        path.lineWidth = 1
        NSColor.white.withAlphaComponent(0.14).setStroke()
        path.stroke()
    }

    // Never intercept clicks — the rows/field below must receive them.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
