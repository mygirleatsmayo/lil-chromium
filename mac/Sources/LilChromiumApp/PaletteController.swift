import AppKit
import LilShared

/// Owns and drives the Spotlight-style palette. One long-lived instance; the
/// panel is created lazily and shown/hidden on demand.
final class PaletteController: NSObject, NSWindowDelegate, NSTextFieldDelegate {

    private let model = PaletteModel()

    private var panel: PalettePanel?
    private var visualEffect: NSVisualEffectView?
    private var inputField: PaletteSearchField?
    private var resultsStack: NSStackView?

    private var currentRows: [PaletteRow] = []
    private var selectedIndex: Int = 0

    // Layout metrics.
    private let panelWidth: CGFloat = 560
    private let inputRowHeight: CGFloat = 56
    private let resultRowHeight: CGFloat = 44
    private let maxResultRows = 8
    private let cornerRadius: CGFloat = 14

    // MARK: - Public entry

    /// Toggle the palette. Called from the ⌘⌥N hotkey and the menu item.
    func toggle() {
        if let panel = panel, panel.isVisible {
            close()
        } else {
            show()
        }
    }

    func show() {
        buildPanelIfNeeded()
        guard let panel = panel, let inputField = inputField else { return }

        // Reset input each open.
        inputField.stringValue = ""
        selectedIndex = 0

        // Refresh history cache on open (async), then re-render.
        refreshHistory()

        // Render initial (empty-query) rows from whatever is cached.
        reload(query: "")

        positionPanel()
        // Spotlight-style: become key without activating the whole app.
        panel.makeKeyAndOrderFront(nil)
        panel.orderFrontRegardless()
        panel.makeFirstResponder(inputField)
    }

    func close() {
        panel?.orderOut(nil)
    }

    // MARK: - Panel construction

    private func buildPanelIfNeeded() {
        if panel != nil { return }

        let initialHeight = inputRowHeight
        let rect = NSRect(x: 0, y: 0, width: panelWidth, height: initialHeight)
        let panel = PalettePanel(
            contentRect: rect,
            styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = false
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
        panel.hasShadow = true
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.delegate = self

        // Visual effect background with rounded corners.
        let vev = NSVisualEffectView(frame: rect)
        vev.material = .hudWindow
        vev.blendingMode = .behindWindow
        vev.state = .active
        vev.wantsLayer = true
        vev.layer?.cornerRadius = cornerRadius
        vev.layer?.masksToBounds = true
        vev.layer?.borderWidth = 1
        vev.layer?.borderColor = NSColor.white.withAlphaComponent(0.12).cgColor
        vev.autoresizingMask = [.width, .height]

        // Search field.
        let field = PaletteSearchField()
        field.translatesAutoresizingMaskIntoConstraints = false
        field.font = .systemFont(ofSize: 18, weight: .regular)
        field.placeholderString = "Search or enter URL…"
        field.isBezeled = false
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.delegate = self
        field.lineBreakMode = .byTruncatingTail
        field.cell?.wraps = false
        field.cell?.isScrollable = true
        field.onArrow = { [weak self] direction in self?.moveSelection(direction) }
        field.onSubmit = { [weak self] in self?.activateSelection() }
        field.onCancel = { [weak self] in self?.close() }

        // Results stack.
        let stack = NSStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.distribution = .fill
        stack.spacing = 0

        vev.addSubview(field)
        vev.addSubview(stack)

        NSLayoutConstraint.activate([
            field.leadingAnchor.constraint(equalTo: vev.leadingAnchor, constant: 20),
            field.trailingAnchor.constraint(equalTo: vev.trailingAnchor, constant: -20),
            field.topAnchor.constraint(equalTo: vev.topAnchor, constant: 0),
            field.heightAnchor.constraint(equalToConstant: inputRowHeight),

            stack.leadingAnchor.constraint(equalTo: vev.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: vev.trailingAnchor),
            stack.topAnchor.constraint(equalTo: field.bottomAnchor),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: vev.bottomAnchor)
        ])

        panel.contentView = vev

        self.panel = panel
        self.visualEffect = vev
        self.inputField = field
        self.resultsStack = stack
    }

    // MARK: - Positioning

    /// Top-right of the PRIMARY display's visibleFrame, 24pt from top/right.
    private func positionPanel() {
        guard let panel = panel else { return }
        let screen = OpenRouter.primaryScreen ?? NSScreen.main
        guard let vf = screen?.visibleFrame else { return }

        let height = currentPanelHeight()
        panel.setContentSize(NSSize(width: panelWidth, height: height))

        let x = vf.maxX - panelWidth - 24
        // AppKit Y: window origin is bottom-left. Top edge at vf.maxY - 24.
        let y = vf.maxY - 24 - height
        panel.setFrameOrigin(NSPoint(x: x, y: y))
    }

    private func currentPanelHeight() -> CGFloat {
        let rows = min(currentRows.count, maxResultRows)
        return inputRowHeight + CGFloat(rows) * resultRowHeight
    }

    // MARK: - Data flow

    private func refreshHistory() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let items = (try? RelayClient.historyQuery(text: "", maxResults: 3000)) ?? []
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.model.setItems(items)
                // Re-render with whatever is currently typed.
                let q = self.inputField?.stringValue ?? ""
                self.reload(query: q)
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
            rowView.configure(row, selected: i == selectedIndex, showHint: i == selectedIndex)
            rowView.heightAnchor.constraint(equalToConstant: resultRowHeight).isActive = true
            stack.addArrangedSubview(rowView)
            rowView.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true

            // Click to activate.
            let click = NSClickGestureRecognizer(target: self, action: #selector(rowClicked(_:)))
            rowView.addGestureRecognizer(click)
            rowView.rowIndex = i
        }
    }

    @objc private func rowClicked(_ gesture: NSClickGestureRecognizer) {
        guard let view = gesture.view as? PaletteRowView else { return }
        let idx = view.rowIndex
        if idx >= 0 && idx < currentRows.count {
            selectedIndex = idx
            activateSelection()
        }
    }

    // MARK: - Selection & activation

    private func moveSelection(_ direction: SearchFieldArrow) {
        guard !currentRows.isEmpty else { return }
        let count = min(currentRows.count, maxResultRows)
        switch direction {
        case .up:
            selectedIndex = (selectedIndex - 1 + count) % count
        case .down:
            selectedIndex = (selectedIndex + 1) % count
        }
        refreshSelectionHighlight()
    }

    private func refreshSelectionHighlight() {
        guard let stack = resultsStack else { return }
        for (i, view) in stack.arrangedSubviews.enumerated() {
            guard let rowView = view as? PaletteRowView, i < currentRows.count else { continue }
            rowView.configure(currentRows[i], selected: i == selectedIndex, showHint: i == selectedIndex)
        }
    }

    private func activateSelection() {
        guard !currentRows.isEmpty, selectedIndex < currentRows.count else {
            // No rows (e.g. empty input, empty history): nothing to open.
            return
        }
        let row = currentRows[selectedIndex]
        let urlString = row.actionURL

        // Anchor the open near the palette: left = palette x - 300 (clamped >= 0),
        // top = palette top edge in Chrome coordinates.
        let (left, top) = paletteAnchorCoords()
        close()
        OpenRouter.open(urlString, left: left, top: top)
    }

    /// Chrome-space coordinates anchored to the palette's current position.
    private func paletteAnchorCoords() -> (left: Int, top: Int) {
        guard let panel = panel, let screen = OpenRouter.primaryScreen ?? NSScreen.main else {
            return (120, 120)
        }
        let frame = panel.frame
        let primaryHeight = screen.frame.height
        // Palette top edge (AppKit) = frame.maxY. Chrome top = primaryHeight - maxY.
        let chromeTop = primaryHeight - frame.maxY
        let left = max(0, Int(frame.minX) - 300)
        return (left, Int(chromeTop.rounded()))
    }

    // MARK: - NSTextFieldDelegate

    func controlTextDidChange(_ obj: Notification) {
        // Reset selection to the top on each edit so Enter opens the best match.
        selectedIndex = 0
        reload(query: inputField?.stringValue ?? "")
    }

    // MARK: - NSWindowDelegate

    func windowDidResignKey(_ notification: Notification) {
        // Click-outside / focus-loss closes the palette.
        close()
    }
}
