import AppKit

/// Draws the accent-tinted rounded-rect selection background behind a row.
final class RowBackgroundView: NSView {
    var isSelected: Bool = false {
        didSet { if isSelected != oldValue { needsDisplay = true } }
    }

    override var wantsUpdateLayer: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        guard isSelected else { return }
        // Inset so the pill floats with margin inside the 44pt row.
        let rect = bounds.insetBy(dx: 8, dy: 4)
        let path = NSBezierPath(roundedRect: rect, xRadius: 8, yRadius: 8)
        NSColor.controlAccentColor.withAlphaComponent(0.25).setFill()
        path.fill()
    }
}

/// A single 44pt palette row:
///   [favicon 20×20 rounded 4] [title 13 medium] [flex] [dimmed domain 11] [hint]
/// Selection = accent pill (see RowBackgroundView). Hover moves selection and
/// click opens (both routed to the controller via callbacks).
final class PaletteRowView: NSView {

    /// Index of this row within the current result list (for click/hover routing).
    var rowIndex: Int = -1

    /// Set by the controller: called when the mouse enters the row (hover→select).
    var onHover: ((Int) -> Void)?
    /// Called on click (open).
    var onClick: ((Int) -> Void)?

    private let background = RowBackgroundView()
    private let iconView = NSImageView()
    private let titleLabel = NSTextField(labelWithString: "")
    private let domainLabel = NSTextField(labelWithString: "")
    private let hintLabel = NSTextField(labelWithString: "")

    /// The host this row currently displays, so a late favicon fetch only lands
    /// if the row still shows that host (rows are reused across queries).
    private var currentHost: String?

    private var trackingArea: NSTrackingArea?

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

        // Priority ordering for the crowded case:
        //   title (highest resistance) > domain > hint (lowest)
        // so when space is tight the HINT truncates/vanishes first, then the
        // domain, and the title is protected. The hint is only ever shown on the
        // selected row, and when shown we hide the domain (see configure), so in
        // practice it's title-vs-hint and the title wins if crowded — matching
        // "show the hint only when it fits, drop it if crowded".
        titleLabel.setContentCompressionResistancePriority(.defaultHigh, for: .horizontal)
        titleLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)
        domainLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        domainLabel.setContentHuggingPriority(.defaultHigh, for: .horizontal)
        hintLabel.setContentCompressionResistancePriority(.init(rawValue: 240), for: .horizontal)
        hintLabel.lineBreakMode = .byClipping

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

    /// Configure the row. `showHint` shows "↵ Open · esc Close" (dropped when the
    /// row is crowded — the layout truncates it, but we also suppress it if the
    /// title/domain are long so it never overlaps).
    func configure(_ row: PaletteRow, selected: Bool, showHint: Bool, index: Int) {
        rowIndex = index
        titleLabel.stringValue = row.title
        background.isSelected = selected
        hintLabel.stringValue = showHint ? "↵ Open  ·  esc Close" : ""
        // When the hint is shown it takes the right slot; blank the domain so it
        // collapses to zero intrinsic width (hidden views still hold layout, so
        // clearing the string — not isHidden — is what actually frees the space).
        // Non-selected rows show the domain.
        domainLabel.stringValue = showHint ? "" : row.subtitle

        // Icon.
        switch row.kind {
        case .search:
            currentHost = nil
            setSymbol("magnifyingglass")
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

    // MARK: - Hover tracking

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let ta = trackingArea { removeTrackingArea(ta) }
        let ta = NSTrackingArea(rect: bounds,
                                options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                owner: self, userInfo: nil)
        addTrackingArea(ta)
        trackingArea = ta
    }

    override func mouseEntered(with event: NSEvent) {
        onHover?(rowIndex)
    }

    override func mouseDown(with event: NSEvent) {
        onClick?(rowIndex)
    }
}
