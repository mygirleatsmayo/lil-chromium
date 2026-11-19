import AppKit
import LilShared

/// Owns and drives the Spotlight-style palette. One long-lived instance; the
/// glass panel is created lazily and shown/hidden on demand.
///
/// Entry points `show()` / `toggle()` are called by AppDelegate — keep them.
@MainActor
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
    private var currentReturnChord: PaletteReturnChord = .plain

    /// Typed text plus any displayed inline completion. Rows and Return derive
    /// from this, never from the raw field text.
    private var input = PaletteInput()
    /// True while the controller itself writes the completion into the field,
    /// so the selection changes it causes are not read as the user accepting it.
    /// verified: setting `stringValue` on an editing field posts
    /// didChangeSelection with the caret at the end — an apparent acceptance.
    private var isApplyingCompletion = false

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

    /// The palette's two functional controls (Settings, Close) share one symbol
    /// size and one square hit area, so neither reads as the smaller of the
    /// pair and both stay comfortably clickable inside the 56pt input row.
    private static let paletteSymbolPointSize: CGFloat = 15
    private static let paletteControlSide: CGFloat = 28

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
        input = PaletteInput()
        inputField.stringValue = ""
        selectedIndex = 0
        currentReturnChord = .plain

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
        reload()

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

    /// The shared Settings launch path: dismiss the palette first so the
    /// surfaces never compete for focus, then present the singleton window.
    func requestSettings() {
        close()
        SettingsWindowController.show()
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
        // NSTextFieldDelegate has no selection callback; the field editor posts
        // this one. Filtered to our field editor in the handler.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(fieldSelectionDidChange(_:)),
            name: NSTextView.didChangeSelectionNotification,
            object: nil
        )

        let settingsButton = NSButton()
        settingsButton.translatesAutoresizingMaskIntoConstraints = false
        settingsButton.isBordered = false
        settingsButton.bezelStyle = .regularSquare
        settingsButton.imagePosition = .imageOnly
        let gearCfg = NSImage.SymbolConfiguration(pointSize: Self.paletteSymbolPointSize, weight: .regular)
        let gearImg = NSImage(systemSymbolName: "gearshape", accessibilityDescription: "Settings")?
            .withSymbolConfiguration(gearCfg)
        gearImg?.isTemplate = true
        settingsButton.image = gearImg
        settingsButton.contentTintColor = .secondaryLabelColor
        settingsButton.setAccessibilityLabel("Settings")
        settingsButton.target = self
        settingsButton.action = #selector(settingsButtonPressed)

        // X close button (circular xmark), top-right of the input row.
        let closeButton = NSButton()
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.isBordered = false
        closeButton.bezelStyle = .regularSquare
        closeButton.imagePosition = .imageOnly
        let xCfg = NSImage.SymbolConfiguration(pointSize: Self.paletteSymbolPointSize, weight: .regular)
        let xImg = NSImage(systemSymbolName: "xmark.circle.fill", accessibilityDescription: "Close")?
            .withSymbolConfiguration(xCfg)
        xImg?.isTemplate = true
        closeButton.image = xImg
        closeButton.contentTintColor = .secondaryLabelColor
        closeButton.setAccessibilityLabel("Close")
        closeButton.target = self
        closeButton.action = #selector(closeButtonPressed)

        inputRow.addSubview(field)
        inputRow.addSubview(settingsButton)
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
            field.trailingAnchor.constraint(equalTo: settingsButton.leadingAnchor, constant: -10),
            field.centerYAnchor.constraint(equalTo: inputRow.centerYAnchor),

            settingsButton.trailingAnchor.constraint(equalTo: closeButton.leadingAnchor, constant: -8),
            settingsButton.centerYAnchor.constraint(equalTo: inputRow.centerYAnchor),
            settingsButton.widthAnchor.constraint(equalToConstant: Self.paletteControlSide),
            settingsButton.heightAnchor.constraint(equalToConstant: Self.paletteControlSide),

            closeButton.trailingAnchor.constraint(equalTo: inputRow.trailingAnchor, constant: -18),
            closeButton.centerYAnchor.constraint(equalTo: inputRow.centerYAnchor),
            closeButton.widthAnchor.constraint(equalToConstant: Self.paletteControlSide),
            closeButton.heightAnchor.constraint(equalToConstant: Self.paletteControlSide),

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
                self.reload()
            }
        }
    }

    /// Recompute rows for the current input and rebuild the stacked row views.
    private func reload() {
        currentRows = model.rows(for: input)
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
                              hint: i == selectedIndex ? actionHint(for: row) : nil,
                              index: i)
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
                              hint: i == selectedIndex ? actionHint(for: currentRows[i]) : nil,
                              index: i)
        }
    }

    private func actionHint(for row: PaletteRow) -> String? {
        model.action(
            for: input.typed,
            selectedRow: row,
            chord: currentReturnChord
        )?.hint
    }

    /// Resolve and open the current Return action. Mouse clicks use the plain
    /// chord; keyboard submission uses the current event's semantic chord.
    private func activateSelection(chord: PaletteReturnChord = .plain) {
        guard !currentRows.isEmpty, selectedIndex < currentRows.count else { return }
        guard let action = model.action(
            for: input.typed,
            selectedRow: currentRows[selectedIndex],
            chord: chord
        ) else { return }
        if action.kind == .settings {
            requestSettings()
            return
        }
        let (left, top) = paletteAnchorCoords()
        close()
        OpenRouter.open(action.url, left: left, top: top, incognito: action.incognito)
    }

    /// Return variants share the `insertNewline:` selector. AppKit flags are
    /// reduced here to the four keys that participate in the action chord.
    /// verified: see research (SO 61806458) — distinguish ⌘-Return from Return
    /// via NSApp.currentEvent.modifierFlags in doCommandBySelector.
    private func returnChordOnCurrentEvent() -> PaletteReturnChord {
        guard let flags = NSApp.currentEvent?.modifierFlags else {
            return currentReturnChord
        }
        return Self.returnChord(from: flags)
    }

    /// Lock state and key-origin metadata are intentionally not chord keys.
    static func returnChord(from flags: NSEvent.ModifierFlags) -> PaletteReturnChord {
        var chord: PaletteReturnChord = .plain
        if flags.contains(.shift) { chord.insert(.shift) }
        if flags.contains(.command) { chord.insert(.command) }
        if flags.contains(.option) { chord.insert(.option) }
        if flags.contains(.control) { chord.insert(.control) }
        return chord
    }

    /// Called by PalettePanel for each flagsChanged event while it is key.
    /// Reconfiguring the selected row makes its hint follow held modifiers.
    func modifierFlagsDidChange(_ flags: NSEvent.ModifierFlags) {
        let chord = Self.returnChord(from: flags)
        guard chord != currentReturnChord else { return }
        currentReturnChord = chord
        refreshSelectionHighlight()
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

    @objc private func settingsButtonPressed() {
        requestSettings()
    }

    // MARK: - NSTextFieldDelegate

    /// The verified key-handling hook. Returning `true` CONSUMES the command and
    /// suppresses the field editor's default (this is what fixes the v0.1
    /// "Enter select-alls" bug). `cancelOperation` returns false so Esc bubbles
    /// to the panel's cancelOperation → close().
    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if input.handle(selector) {
            // Drop the selected remainder so the field reads as accepted.
            textView.setSelectedRange(NSRange(location: (textView.string as NSString).length, length: 0))
            selectedIndex = 0
            reload()
            return true
        }
        switch selector {
        case #selector(NSResponder.insertNewline(_:)):
            activateSelection(chord: returnChordOnCurrentEvent())
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
        input = model.editing(input, to: field.stringValue)
        // Reset selection to the top on each edit so Enter opens the best match.
        selectedIndex = 0
        reload()
        showCompletion(in: field)
    }

    /// Write the completed text into the field and SELECT the appended
    /// remainder, so the next keystroke replaces it ("git" → "git[hub.com]").
    private func showCompletion(in field: PaletteSearchField) {
        guard let range = input.completionRange, let editor = field.fieldText else { return }
        isApplyingCompletion = true
        defer { isApplyingCompletion = false }
        field.stringValue = input.text
        editor.selectedRange = range
    }

    /// →, ⌘→, End, or a click that drops the selected remainder accepts the
    /// completion: rows and hint recompute for the full field text. Reads the
    /// editor's current state, so it is correct whether AppKit posts this
    /// before or after the text-change callback of an edit.
    /// verified: typing over or deleting the selection posts this first, with
    /// the edited text (≠ `input.text`, so a no-op), then controlTextDidChange;
    /// moveRight: and moveToEndOfLine: post it with the text unchanged.
    @objc private func fieldSelectionDidChange(_ note: Notification) {
        guard !isApplyingCompletion,
              let editor = inputField?.fieldText,
              (note.object as AnyObject?) === editor,
              input.selectionDidChange(to: editor.selectedRange, in: editor.string)
        else { return }
        selectedIndex = 0
        reload()
    }
}
