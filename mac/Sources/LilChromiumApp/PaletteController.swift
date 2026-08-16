import AppKit
import LilShared

/// Owns and drives the Spotlight-style palette. One long-lived instance; the
/// glass panel is created lazily and shown/hidden on demand.
///
/// Entry points `show()` / `toggle()` are called by AppDelegate — keep them.
final class PaletteController: NSObject, NSTextFieldDelegate {

    private let model = PaletteModel()

    private var panel: PalettePanel?
    private var container: NSView?
    private var contentRoot: NSView?
    private var inputField: PaletteSearchField?
    private var resultsStack: NSStackView?
    private var hairline: HairlineBorderView?

    private var currentRows: [PaletteRow] = []
    private var selectedIndex: Int = 0

    // Inline autocomplete state.
    /// The text the user has actually typed (excludes auto-appended completion).
    /// Enter always opens row 0 (the top hit), so an "is completion active" flag
    /// is unnecessary — the completion is purely visual.
    private var committedQuery: String = ""

    /// Anchor read fresh at each show() (a cheap file read, always fresh) and
    /// cached for the session so per-keystroke repositioning doesn't re-read the
    /// config file. Refreshed on the next show().
    private var currentAnchor: String = "top-center"

    // Layout metrics.
    private let panelWidth: CGFloat = 620
    private let inputRowHeight: CGFloat = 56
    private let resultRowHeight: CGFloat = 44
    private let maxResultRows = 8
    private let cornerRadius = PaletteGlass.cornerRadius

    // MARK: - Public entry points (called by AppDelegate)

    /// Toggle the palette. Called from the ⌘⌥N hotkey and the menu item.
    func toggle() {
        if let panel = panel, panel.isVisible {
            close()
        } else {
            show()
        }
    }

    /// Show (or re-focus) the palette. Positions per the current config anchor.
    func show() {
        buildPanelIfNeeded()
        guard let panel = panel, let inputField = inputField else { return }

        // Reset input + autocomplete state each open.
        inputField.stringValue = ""
        committedQuery = ""
        selectedIndex = 0

        // Read config fresh at each show() (always current), cache for the
        // session so per-keystroke reposition/row-building doesn't re-hit the
        // config file. Anchor drives positioning; searchEngine drives the
        // "Search {name} for …" row.
        let cfg = LilConfig.load()
        currentAnchor = cfg.paletteAnchor
        model.searchEngine = cfg.searchEngine

        // Refresh history cache on open (async) then re-render.
        refreshHistory()

        // Render initial (empty-query) rows from whatever is cached.
        reload(query: "")

        positionPanel()
        // Become key WITHOUT activating the whole app (accessory stays put).
        panel.orderFrontRegardless()
        panel.makeKey()
        panel.makeFirstResponder(inputField)
    }

    /// Close the palette. The ONLY paths that call this: Esc, ⌘⌥N toggle, the X
    /// button, opening a result, and showing Settings. No resignKey /
    /// deactivation path exists.
    func close() {
        panel?.orderOut(nil)
    }

    // MARK: - Panel construction

    private func buildPanelIfNeeded() {
        if panel != nil { return }

        let rect = NSRect(x: 0, y: 0, width: panelWidth, height: inputRowHeight)
        let panel = PalettePanel(
            contentRect: rect,
            styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.paletteDelegate = self
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = false
        panel.hidesOnDeactivate = false           // stay up when app deactivates
        panel.isMovableByWindowBackground = false
        panel.hasShadow = true
        panel.backgroundColor = .clear            // REQUIRED for glass to show
        panel.isOpaque = false

        // Content root: a plain view holding the input row + results stack.
        // FIXED WIDTH: the root is pinned to exactly `panelWidth` at REQUIRED
        // priority so nothing inside (a long title, a long URL) can ever widen
        // the panel. Everything below inherits this width via the stack.
        let root = NSView()
        root.translatesAutoresizingMaskIntoConstraints = false
        let rootWidth = root.widthAnchor.constraint(equalToConstant: panelWidth)
        rootWidth.priority = .required
        rootWidth.isActive = true
        // Resist any attempt by subviews to compress the root below 620 too.
        root.setContentHuggingPriority(.required, for: .horizontal)
        root.setContentCompressionResistancePriority(.required, for: .horizontal)

        // --- Input row: a fixed 56pt container. The field is pinned by
        // centerYAnchor (NOT stretched to fill) so its single line of text is
        // vertically centered — a tall NSTextField draws its text at the top,
        // which was the v0.1 "input top-justified" bug. ---
        let inputRow = NSView()
        inputRow.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(inputRow)

        let field = PaletteSearchField()
        field.configureAsPaletteInput()
        field.delegate = self

        // X close button (circular xmark), top-right of the input row.
        let closeButton = NSButton()
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.isBordered = false
        closeButton.bezelStyle = .regularSquare
        closeButton.imagePosition = .imageOnly
        let xCfg = NSImage.SymbolConfiguration(pointSize: 15, weight: .regular)
        let xImg = NSImage(systemSymbolName: "xmark.circle.fill", accessibilityDescription: "Close")?
            .withSymbolConfiguration(xCfg)
        xImg?.isTemplate = true
        closeButton.image = xImg
        closeButton.contentTintColor = .secondaryLabelColor
        closeButton.target = self
        closeButton.action = #selector(closeButtonPressed)

        inputRow.addSubview(field)
        inputRow.addSubview(closeButton)

        // --- Results stack ---
        let stack = NSStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.distribution = .fill
        stack.spacing = 0
        root.addSubview(stack)

        NSLayoutConstraint.activate([
            // Fixed-height input row spanning the top of the content.
            inputRow.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            inputRow.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            inputRow.topAnchor.constraint(equalTo: root.topAnchor),
            inputRow.heightAnchor.constraint(equalToConstant: inputRowHeight),

            // Field: leading inset 20, vertically centered, intrinsic height.
            field.leadingAnchor.constraint(equalTo: inputRow.leadingAnchor, constant: 20),
            field.trailingAnchor.constraint(equalTo: closeButton.leadingAnchor, constant: -10),
            field.centerYAnchor.constraint(equalTo: inputRow.centerYAnchor),

            closeButton.trailingAnchor.constraint(equalTo: inputRow.trailingAnchor, constant: -18),
            closeButton.centerYAnchor.constraint(equalTo: inputRow.centerYAnchor),
            closeButton.widthAnchor.constraint(equalToConstant: 22),
            closeButton.heightAnchor.constraint(equalToConstant: 22),

            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            stack.topAnchor.constraint(equalTo: inputRow.bottomAnchor),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: root.bottomAnchor)
        ])

        // Hairline border overlay: added to `root` (the glass CONTENT view, the
        // only reliably-rendered layer inside NSGlassEffectView) as the topmost
        // subview so it traces the panel edge. hitTest returns nil so it never
        // intercepts row/field clicks.
        let hairline = HairlineBorderView()
        hairline.translatesAutoresizingMaskIntoConstraints = false
        hairline.cornerRadius = cornerRadius
        root.addSubview(hairline)   // last-added → drawn on top
        NSLayoutConstraint.activate([
            hairline.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            hairline.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            hairline.topAnchor.constraint(equalTo: root.topAnchor),
            hairline.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])

        // Wrap the root in glass (or fallback).
        let container = PaletteGlass.makeContainer(content: root)
        panel.contentView = container

        self.panel = panel
        self.container = container
        self.contentRoot = root
        self.inputField = field
        self.resultsStack = stack
        self.hairline = hairline
    }

    // MARK: - Positioning (per config anchor)

    /// Position per `currentAnchor` (read from config fresh at each show()).
    ///   top-center (default): horizontally centered on the primary display;
    ///     panel TOP edge at visibleFrame.maxY − 0.20 × visibleFrame.height.
    ///   top-right: 24pt insets from the top-right of the visibleFrame.
    private func positionPanel() {
        guard let panel = panel,
              let screen = OpenRouter.primaryScreen ?? NSScreen.main else { return }
        let vf = screen.visibleFrame

        let size = NSSize(width: panelWidth, height: currentPanelHeight())
        panel.setContentSize(size)

        if currentAnchor == "top-right" {
            // AppKit origin is bottom-left, so origin.y = topEdge − height.
            panel.setFrameOrigin(NSPoint(x: vf.maxX - panelWidth - 24,
                                         y: vf.maxY - 24 - size.height))
        } else {
            // "top-center" (default and any unknown value). Settings reuses this
            // same geometry for its first presentation.
            panel.setFrameOrigin(PalettePlacement.centeredOrigin(forSize: size, on: screen))
        }
    }

    private func currentPanelHeight() -> CGFloat {
        let rows = min(currentRows.count, maxResultRows)
        return inputRowHeight + CGFloat(rows) * resultRowHeight
    }

    // MARK: - Data flow

    private func refreshHistory() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let items = (try? RelayClient.historyQuery(text: "", maxResults: 3000)) ?? []
            // Build the index off the main thread (parsing 3000 URLs is the
            // expensive part; do it once here, not per keystroke).
            let index = Ranking.buildIndex(items: items)
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.model.setIndex(index)
                // Re-render with whatever is currently typed.
                self.reload(query: self.committedQuery)
            }
        }
    }

    /// Recompute rows for a query and rebuild the stacked row views.
    private func reload(query: String) {
        currentRows = model.rows(for: query)
        if currentRows.isEmpty {
            selectedIndex = 0
        } else if selectedIndex >= currentRows.count {
            selectedIndex = currentRows.count - 1
        }
        rebuildRowViews()
        positionPanel()
    }

    private func rebuildRowViews() {
        guard let stack = resultsStack else { return }
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }

        for (i, row) in currentRows.prefix(maxResultRows).enumerated() {
            let rowView = PaletteRowView()
            rowView.configure(row, selected: i == selectedIndex,
                              showHint: i == selectedIndex, index: i)
            rowView.heightAnchor.constraint(equalToConstant: resultRowHeight).isActive = true
            rowView.onHover = { [weak self] idx in self?.hoverSelect(idx) }
            rowView.onClick = { [weak self] idx in self?.clickRow(idx) }
            stack.addArrangedSubview(rowView)
            // Pin each row to the stack width at REQUIRED priority: rows never
            // dictate width, they inherit the fixed 620 (via stack == root width).
            // The row's own labels have LOW compression resistance so their text
            // truncates within this width instead of pushing it wider.
            let w = rowView.widthAnchor.constraint(equalTo: stack.widthAnchor)
            w.priority = .required
            w.isActive = true
        }
    }

    private func clickRow(_ idx: Int) {
        guard idx >= 0 && idx < currentRows.count else { return }
        selectedIndex = idx
        activateSelection()
    }

    private func hoverSelect(_ idx: Int) {
        guard idx >= 0 && idx < currentRows.count, idx != selectedIndex else { return }
        selectedIndex = idx
        refreshSelectionHighlight()
    }

    // MARK: - Selection & activation

    private enum Direction { case up, down }

    private func moveSelection(_ direction: Direction) {
        guard !currentRows.isEmpty else { return }
        let count = min(currentRows.count, maxResultRows)
        switch direction {
        case .up:   selectedIndex = (selectedIndex - 1 + count) % count  // wraparound
        case .down: selectedIndex = (selectedIndex + 1) % count
        }
        refreshSelectionHighlight()
    }

    private func refreshSelectionHighlight() {
        guard let stack = resultsStack else { return }
        for (i, view) in stack.arrangedSubviews.enumerated() {
            guard let rowView = view as? PaletteRowView, i < currentRows.count else { continue }
            rowView.configure(currentRows[i], selected: i == selectedIndex,
                              showHint: i == selectedIndex, index: i)
        }
    }

    /// Open the current selection. `incognito` (palette ⌘-Enter) opens the
    /// selection as an incognito lil (open.incognito:true), passed through to the
    /// relay open call.
    private func activateSelection(incognito: Bool = false) {
        guard !currentRows.isEmpty, selectedIndex < currentRows.count else { return }
        let row = currentRows[selectedIndex]
        let urlString = row.actionURL
        let (left, top) = paletteAnchorCoords()
        close()
        OpenRouter.open(urlString, left: left, top: top, incognito: incognito)
    }

    /// True when the current AppKit event has Command as its only non-Return
    /// modifier — used to detect ⌘-Enter, which shares the `insertNewline:`
    /// selector with a plain Return in the field editor.
    /// verified: see research (SO 61806458) — distinguish ⌘-Return from Return
    /// via NSApp.currentEvent.modifierFlags in doCommandBySelector.
    private func commandHeldOnCurrentEvent() -> Bool {
        guard let flags = NSApp.currentEvent?.modifierFlags else { return false }
        return flags.intersection(.deviceIndependentFlagsMask).contains(.command)
    }

    /// Chrome-space coordinates anchored to the palette's current position.
    private func paletteAnchorCoords() -> (left: Int, top: Int) {
        guard let panel = panel, let screen = OpenRouter.primaryScreen ?? NSScreen.main else {
            return (120, 120)
        }
        let frame = panel.frame
        let primaryHeight = screen.frame.height
        let chromeTop = primaryHeight - frame.maxY
        let left = max(0, Int(frame.minX) - 300)
        return (left, Int(chromeTop.rounded()))
    }

    @objc private func closeButtonPressed() {
        close()
    }

    // MARK: - NSTextFieldDelegate

    /// The verified key-handling hook. Returning `true` CONSUMES the command and
    /// suppresses the field editor's default (this is what fixes the v0.1
    /// "Enter select-alls" bug). `cancelOperation` returns false so Esc bubbles
    /// to the panel's cancelOperation → close().
    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        switch selector {
        case #selector(NSResponder.insertNewline(_:)):
            // Plain Return opens normally; ⌘-Return opens as an incognito lil.
            // Both arrive as insertNewline: — the modifier is read off the
            // current AppKit event.
            activateSelection(incognito: commandHeldOnCurrentEvent())
            return true
        case #selector(NSResponder.moveUp(_:)):
            moveSelection(.up)
            return true
        case #selector(NSResponder.moveDown(_:)):
            moveSelection(.down)
            return true
        case #selector(NSResponder.cancelOperation(_:)):
            // Let the panel handle Esc (close). Do not consume here.
            return false
        default:
            return false
        }
    }

    func controlTextDidChange(_ obj: Notification) {
        guard let field = inputField else { return }
        let newText = field.stringValue

        // Deletion detection: compare against what the user had typed before.
        // Autocomplete must NEVER fire after a deletion (per contract), so any
        // change that isn't a strict forward extension of the committed query
        // is treated as a deletion/edit.
        let isInsertion = newText.count > committedQuery.count
                          && newText.lowercased().hasPrefix(committedQuery.lowercased())

        // The current user-typed text becomes the new committed query. When
        // autocomplete was active, typing over the selected completion yields
        // exactly the new typed text here (the selection was replaced).
        committedQuery = newText

        // Reset selection to the top on each edit so Enter opens the best match.
        selectedIndex = 0
        reload(query: newText)

        // Inline type-ahead: only on insertions, only if the top hit's host
        // starts with the typed text (case-insensitive, "www." already stripped
        // in the index).
        if isInsertion, !newText.isEmpty {
            applyAutocomplete(typed: newText, field: field)
        }
    }

    /// If the current top-hit host begins with `typed`, complete the field to the
    /// full host and SELECT the appended portion (so the next keystroke replaces
    /// it — the "git → git[hub.com]" behavior).
    private func applyAutocomplete(typed: String, field: PaletteSearchField) {
        guard let host = model.autocompleteHost(for: typed) else { return }
        let lowerTyped = typed.lowercased()
        let lowerHost = host.lowercased()
        // Host must start with the typed text and be strictly longer.
        guard lowerHost.hasPrefix(lowerTyped), lowerHost.count > lowerTyped.count else { return }

        // Preserve the user's original casing for the typed prefix; append the
        // remainder of the host verbatim.
        let remainderStart = host.index(host.startIndex, offsetBy: typed.count)
        let completed = typed + String(host[remainderStart...])

        field.stringValue = completed
        // Select the appended range using UTF-16 offsets (NSRange is UTF-16).
        guard let editor = field.fieldText else { return }
        let base = (typed as NSString).length
        let full = (completed as NSString).length
        editor.selectedRange = NSRange(location: base, length: full - base)
        // committedQuery stays as the user-typed text (not the completion), so
        // the next change's insertion/deletion check is against the real prefix.
    }
}
