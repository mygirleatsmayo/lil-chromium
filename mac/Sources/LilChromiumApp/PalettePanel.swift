import AppKit

/// A borderless, non-activating panel that can still become key so the search
/// field is typeable while the app stays .accessory. Verified pattern: subclass
/// NSPanel, override canBecomeKey=true / canBecomeMain=false, use
/// .nonactivatingPanel and orderFrontRegardless() (see SaneClip / Maccy prior
/// art). This lets us receive key events without stealing the menu bar.
final class PalettePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    // Escape and ⌘-anything routing convenience: forward cancelOperation.
    override func cancelOperation(_ sender: Any?) {
        // The controller installs itself as delegate and handles closing on
        // resignKey; we also close directly here for the Esc key.
        (delegate as? PaletteController)?.close()
    }
}

/// A view that draws the accent-tinted rounded selection background for a row.
final class RowBackgroundView: NSView {
    var isSelected: Bool = false {
        didSet { needsDisplay = true }
    }

    override func draw(_ dirtyRect: NSRect) {
        guard isSelected else { return }
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 6, dy: 3),
                                xRadius: 8, yRadius: 8)
        NSColor.controlAccentColor.withAlphaComponent(0.22).setFill()
        path.fill()
    }
}

/// A single result row view: primary title line + secondary URL line.
final class PaletteRowView: NSView {
    /// Index of this row within the current result list (for click routing).
    var rowIndex: Int = -1
    let background = RowBackgroundView()
    let titleLabel = NSTextField(labelWithString: "")
    let subtitleLabel = NSTextField(labelWithString: "")
    let hintLabel = NSTextField(labelWithString: "")

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
        background.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        subtitleLabel.translatesAutoresizingMaskIntoConstraints = false
        hintLabel.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.font = .systemFont(ofSize: 13, weight: .medium)
        titleLabel.textColor = .labelColor
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.maximumNumberOfLines = 1
        titleLabel.isBezeled = false
        titleLabel.drawsBackground = false
        titleLabel.isEditable = false

        subtitleLabel.font = .systemFont(ofSize: 11, weight: .regular)
        subtitleLabel.textColor = .secondaryLabelColor
        subtitleLabel.lineBreakMode = .byTruncatingTail
        subtitleLabel.maximumNumberOfLines = 1
        subtitleLabel.isBezeled = false
        subtitleLabel.drawsBackground = false
        subtitleLabel.isEditable = false

        hintLabel.font = .systemFont(ofSize: 11, weight: .regular)
        hintLabel.textColor = .tertiaryLabelColor
        hintLabel.alignment = .right
        hintLabel.isBezeled = false
        hintLabel.drawsBackground = false
        hintLabel.isEditable = false
        hintLabel.stringValue = ""

        addSubview(background)
        addSubview(titleLabel)
        addSubview(subtitleLabel)
        addSubview(hintLabel)

        NSLayoutConstraint.activate([
            background.leadingAnchor.constraint(equalTo: leadingAnchor),
            background.trailingAnchor.constraint(equalTo: trailingAnchor),
            background.topAnchor.constraint(equalTo: topAnchor),
            background.bottomAnchor.constraint(equalTo: bottomAnchor),

            titleLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 18),
            titleLabel.topAnchor.constraint(equalTo: topAnchor, constant: 5),
            titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: hintLabel.leadingAnchor, constant: -8),

            subtitleLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 18),
            subtitleLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 1),
            subtitleLabel.trailingAnchor.constraint(lessThanOrEqualTo: hintLabel.leadingAnchor, constant: -8),

            hintLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -18),
            hintLabel.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
    }

    func configure(_ row: PaletteRow, selected: Bool, showHint: Bool) {
        titleLabel.stringValue = row.title
        subtitleLabel.stringValue = row.subtitle
        background.isSelected = selected
        hintLabel.stringValue = showHint ? "↵ Open  ·  esc Close" : ""
    }
}
