import AppKit

/// Draws the accent-tinted rounded-rect highlight behind a row. Hovered uses
/// the selected pill's shape at lower opacity; a row has exactly one highlight,
/// so the two never stack.
final class RowBackgroundView: NSView {
    var highlight: PaletteSelection.Highlight = .none {
        didSet { if highlight != oldValue { needsDisplay = true } }
    }

    override var wantsUpdateLayer: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        let alpha: CGFloat
        switch highlight {
        case .none: return
        case .hovered: alpha = 0.12
        case .selected: alpha = 0.25
        }
        // Inset so the pill floats with margin inside the 44pt row.
        let rect = bounds.insetBy(dx: 8, dy: 4)
        let path = NSBezierPath(roundedRect: rect, xRadius: 8, yRadius: 8)
        NSColor.controlAccentColor.withAlphaComponent(alpha).setFill()
        path.fill()
    }
}

/// The results list. Reports every pointer move, entry, and exit so the
/// controller can hit-test the row actually under the pointer.
final class PaletteResultsStackView: NSStackView {

    var onPointerChange: (() -> Void)?

    private var trackingArea: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let ta = trackingArea { removeTrackingArea(ta) }
        let ta = NSTrackingArea(rect: bounds,
                                options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect],
                                owner: self, userInfo: nil)
        addTrackingArea(ta)
        trackingArea = ta
    }

    override func mouseEntered(with event: NSEvent) { onPointerChange?() }
    override func mouseMoved(with event: NSEvent) { onPointerChange?() }
    override func mouseExited(with event: NSEvent) { onPointerChange?() }
}

/// A single 44pt palette row:
///   [favicon 20×20 rounded 4] [title 13 medium] [flex] [dimmed domain 11] [hint]
/// Highlight = accent pill (see RowBackgroundView). Hover is tracked by the
/// results list, not the row; a click is routed to the controller (select+open).
final class PaletteRowView: NSView {

    /// Index of this row within the current result list (for click routing).
    var rowIndex: Int = -1

    /// Called on click (select + open).
    var onClick: ((Int) -> Void)?

    private let background = RowBackgroundView()
    private let iconView = NSImageView()
    private let titleLabel = NSTextField(labelWithString: "")
    private let domainLabel = NSTextField(labelWithString: "")
    private let hintLabel = NSTextField(labelWithString: "")

    /// The host this row currently displays, so a late favicon fetch only lands
    /// if the row still shows that host (rows are reused across queries).
    private var currentHost: String?

    /// Shown in the right slot whenever the row carries no hint.
    private var subtitle = ""

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setup()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setup()
    }

    private func setup() {
        translatesAutoresizingMaskIntoConstraints = false
        wantsLayer = true

        background.translatesAutoresizingMaskIntoConstraints = false

        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.imageScaling = .scaleProportionallyUpOrDown
        iconView.wantsLayer = true
        iconView.layer?.cornerRadius = 4
        iconView.layer?.masksToBounds = true

        configureLabel(titleLabel, font: .systemFont(ofSize: 13, weight: .medium),
                       color: .labelColor, alignment: .left)
        configureLabel(domainLabel, font: .systemFont(ofSize: 11, weight: .regular),
                       color: .secondaryLabelColor, alignment: .right)
        // Domain truncates from the HEAD so the informative tail (host) stays.
        domainLabel.lineBreakMode = .byTruncatingHead
        configureLabel(hintLabel, font: .systemFont(ofSize: 11, weight: .regular),
                       color: .tertiaryLabelColor, alignment: .right)
        hintLabel.stringValue = ""

        addSubview(background)
        addSubview(iconView)
        addSubview(titleLabel)
        addSubview(domainLabel)
        addSubview(hintLabel)

        // FIXED-WIDTH DISCIPLINE: the panel is pinned to 620 upstream (root +
        // per-row width constraints). Every label here has LOW horizontal
        // compression resistance so its text TRUNCATES within the imposed width
        // rather than pushing the row — and thus the panel — wider. The title
        // truncates at the tail (see configureLabel), the domain at the head, so
        // the informative ends stay visible.
        //
        // Relative ordering for the crowded case (which label yields first): the
        // title is the most protected of the three, then the domain, then the
        // hint. All three stay strictly below .defaultLow so none can ever exceed
        // the required width constraint and expand the panel.
        titleLabel.setContentCompressionResistancePriority(.init(rawValue: 200), for: .horizontal)
        titleLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)
        domainLabel.setContentCompressionResistancePriority(.init(rawValue: 150), for: .horizontal)
        domainLabel.setContentHuggingPriority(.defaultHigh, for: .horizontal)
        hintLabel.setContentCompressionResistancePriority(.init(rawValue: 120), for: .horizontal)
        hintLabel.lineBreakMode = .byClipping

        // The row itself must accept the width imposed by the controller (equal
        // to the stack/root width) — never grow to fit its content.
        setContentHuggingPriority(.defaultLow, for: .horizontal)
        setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        NSLayoutConstraint.activate([
            background.leadingAnchor.constraint(equalTo: leadingAnchor),
            background.trailingAnchor.constraint(equalTo: trailingAnchor),
            background.topAnchor.constraint(equalTo: topAnchor),
            background.bottomAnchor.constraint(equalTo: bottomAnchor),

            iconView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 18),
            iconView.centerYAnchor.constraint(equalTo: centerYAnchor),
            iconView.widthAnchor.constraint(equalToConstant: 20),
            iconView.heightAnchor.constraint(equalToConstant: 20),

            titleLabel.leadingAnchor.constraint(equalTo: iconView.trailingAnchor, constant: 12),
            titleLabel.centerYAnchor.constraint(equalTo: centerYAnchor),

            // Domain sits to the right of the title with a flexible gap.
            domainLabel.leadingAnchor.constraint(greaterThanOrEqualTo: titleLabel.trailingAnchor, constant: 12),
            domainLabel.centerYAnchor.constraint(equalTo: centerYAnchor),
            domainLabel.trailingAnchor.constraint(equalTo: hintLabel.leadingAnchor, constant: -10),

            hintLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -18),
            hintLabel.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
    }

    private func configureLabel(_ label: NSTextField, font: NSFont, color: NSColor, alignment: NSTextAlignment) {
        label.translatesAutoresizingMaskIntoConstraints = false
        label.font = font
        label.textColor = color
        label.alignment = alignment
        label.lineBreakMode = .byTruncatingTail
        label.maximumNumberOfLines = 1
        label.isBezeled = false
        label.isBordered = false
        label.drawsBackground = false
        label.isEditable = false
        label.isSelectable = false
    }

    // MARK: - Configuration

    /// Configure the row's content. Highlight and hint are set separately
    /// (`setHighlight`) so hover changes never reload icons.
    func configure(_ row: PaletteRow, index: Int) {
        rowIndex = index
        titleLabel.stringValue = row.title
        subtitle = row.subtitle

        // Icon.
        switch row.kind {
        case .search:
            currentHost = nil
            setSymbol("magnifyingglass")
        case .settings:
            currentHost = nil
            setSymbol("gearshape")
        case .openURL:
            currentHost = row.host
            // Prefer a favicon if we can derive a host, else an arrow glyph.
            if let host = row.host, !host.isEmpty {
                loadFavicon(host: host)
            } else {
                setSymbol("arrow.up.forward.app")
            }
        case .history:
            currentHost = row.host
            if let host = row.host, !host.isEmpty {
                loadFavicon(host: host)
            } else {
                setSymbol("globe")
            }
        }
    }

    /// The selected row receives the exact Return action's modifier-aware hint;
    /// other rows receive nil.
    func setHighlight(_ highlight: PaletteSelection.Highlight, hint: String?) {
        background.highlight = highlight
        hintLabel.stringValue = hint ?? ""
        // When the hint is shown it takes the right slot; blank the domain so it
        // collapses to zero intrinsic width (hidden views still hold layout, so
        // clearing the string — not isHidden — is what actually frees the space).
        domainLabel.stringValue = hint == nil ? subtitle : ""
    }

    private func setSymbol(_ name: String) {
        iconView.layer?.cornerRadius = 0
        let cfg = NSImage.SymbolConfiguration(pointSize: 14, weight: .regular)
        let img = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
            .withSymbolConfiguration(cfg)
        img?.isTemplate = true
        iconView.contentTintColor = .secondaryLabelColor
        iconView.image = img
    }

    private func loadFavicon(host: String) {
        // Placeholder immediately.
        iconView.layer?.cornerRadius = 4
        iconView.contentTintColor = .secondaryLabelColor
        iconView.image = FaviconCache.shared.placeholder
        FaviconCache.shared.icon(for: host) { [weak self] image in
            guard let self = self, let image = image else { return }
            // Guard: only apply if the row still shows this host.
            guard self.currentHost == host else { return }
            self.iconView.contentTintColor = nil
            self.iconView.image = image
        }
    }

    // MARK: - Click

    override func mouseDown(with event: NSEvent) {
        onClick?(rowIndex)
    }
}
