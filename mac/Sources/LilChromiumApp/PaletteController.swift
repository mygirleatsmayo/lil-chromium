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
    private var tabHintLabel: NSTextField?
    private var resultsStack: PaletteResultsStackView?
    private var hairline: HairlineBorderView?

    private var currentRows: [PaletteRow] = []
    private var selection = PaletteSelection()
    private var currentReturnChord: PaletteReturnChord = .plain

    /// Typed text plus any displayed inline completion. Rows and Return derive
    /// from this, never from the raw field text.
    private var input = PaletteInput()
    /// True while the controller itself writes the field (a completion or a
    /// row preview), so the selection changes it causes are not read as the
    /// user accepting a completion.
    /// verified: setting `stringValue` on an editing field posts
    /// didChangeSelection with the caret at the end — an apparent acceptance.
    private var isWritingField = false

    /// Typed queries rank off the main thread: across a full history window
    /// (20,000 items) one keystroke takes ~100 ms in a release build (issue
    /// #41). Serial, so a newer query never races an older one; each edit
    /// cancels the queued one and takes a new model ranking ticket, so a
    /// result that lands after a newer edit is dropped.
    private let rankQueue = DispatchQueue(label: "com.lilchromium.palette.rank", qos: .userInteractive)
    private var pendingRank: DispatchWorkItem?

    /// Anchor read fresh at each show() (a cheap file read, always fresh) and
    /// cached for the session so per-keystroke repositioning doesn't re-read the
    /// config file. Refreshed on the next show().
    private var currentAnchor: String = "top-center"

    // Layout metrics.
    private let panelWidth: CGFloat = 620
    private let inputRowHeight: CGFloat = 56
    private let resultRowHeight: CGFloat = 44
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
        refreshTabHint()
        currentReturnChord = .plain

        // Read config fresh at each show() (always current), cache for the
        // session so per-keystroke reposition/row-building doesn't re-hit the
        // config file. Anchor drives positioning; searchEngine drives the
        // "Search {name} for …" row; palette sets the row budget and word
        // matching (issue #43).
        let cfg = LilConfig.load()
        currentAnchor = cfg.paletteAnchor
        model.searchEngine = cfg.searchEngine
        model.config = cfg.palette

        // Refresh history cache on open (async) then re-render.
        refreshHistory()

        // Render initial (empty-query) rows from whatever is cached. The empty
        // query is a frecency listing (~1 ms at 20,000 items), so the palette
        // appears complete at once.
        cancelPendingRank()
        render(model.rows(for: ""), resetSelection: true)

        positionPanel()
        // Become key WITHOUT activating the whole app (accessory stays put).
        panel.orderFrontRegardless()
        panel.makeKey()
        panel.makeFirstResponder(inputField)
        // Hover reflects only where the pointer is now, never a past session.
        syncHoverToPointer()
    }

    /// Close the palette. The ONLY paths that call this: Esc, ⌘⌥N toggle, the X
    /// button, opening a result, and showing Settings. No resignKey /
    /// deactivation path exists.
    func close() {
        cancelPendingRank()
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

        // Dim trailing `Search ⇥` hint (Raycast's Tab hint). It shares a stack
        // with the field: the stack detaches it while hidden, so the field
        // spans the row; while shown, the field yields width and scrolls, so
        // the hint never overlaps typed text.
        // verified: macOS 27.0.1, 2026-11-19 probe — hiding the hint returns its width plus
        // the 10pt spacing to the field; shown, field.maxX < hint.minX.
        let tabHint = NSTextField(labelWithString: "")
        tabHint.font = .systemFont(ofSize: 13, weight: .regular)
        tabHint.textColor = .tertiaryLabelColor
        tabHint.isHidden = true
        tabHint.setContentHuggingPriority(.required, for: .horizontal)
        tabHint.setContentCompressionResistancePriority(.required, for: .horizontal)
        field.setContentHuggingPriority(.defaultLow - 1, for: .horizontal)
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let fieldStack = NSStackView(views: [field, tabHint])
        fieldStack.translatesAutoresizingMaskIntoConstraints = false
        fieldStack.orientation = .horizontal
        fieldStack.alignment = .centerY
        fieldStack.spacing = 10

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

        inputRow.addSubview(fieldStack)
        inputRow.addSubview(settingsButton)
        inputRow.addSubview(closeButton)

        // --- Results stack ---
        let stack = PaletteResultsStackView()
        stack.onPointerChange = { [weak self] in self?.syncHoverToPointer() }
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

            // Field (+ Tab hint): leading inset 20, vertically centered,
            // intrinsic height.
            fieldStack.leadingAnchor.constraint(equalTo: inputRow.leadingAnchor, constant: 20),
            fieldStack.trailingAnchor.constraint(equalTo: settingsButton.leadingAnchor, constant: -10),
            fieldStack.centerYAnchor.constraint(equalTo: inputRow.centerYAnchor),

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
        self.tabHintLabel = tabHint
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
        // The model caps rows at `palette.maxResults`, so the height follows it.
        inputRowHeight + CGFloat(currentRows.count) * resultRowHeight
    }

    // MARK: - Data flow

    private func refreshHistory() {
        let ticket = model.beginRefresh()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            // A failed or timed-out refresh keeps the snapshot the palette has.
            guard let items = try? RelayClient.historyWindow() else { return }
            // Build the index off the main thread (parsing every URL in the
            // window is the expensive part; do it once here, not per keystroke).
            let index = Ranking.buildIndex(items: items)
            DispatchQueue.main.async {
                guard let self, self.model.install(index, from: ticket) else { return }
                // Re-render with whatever is currently typed. `render` clamps
                // rather than resets: the user may already have arrowed down.
                self.reload()
            }
        }
    }

    /// Recompute rows for the typed text off the main thread, then render them
    /// if no newer edit arrived meanwhile. `autocomplete` also offers inline
    /// type-ahead for the top hit once the rows land.
    private func reload(autocomplete: Bool = false) {
        pendingRank?.cancel()
        let ticket = model.beginRanking()
        let worker = model.copy()
        let query = input.typed
        let work = DispatchWorkItem { [weak self] in
            let ranked = worker.results(for: query)
            DispatchQueue.main.async {
                guard let self, let results = self.model.land(ranked, from: ticket) else { return }
                self.pendingRank = nil
                // Rows depend on the text alone; a completion also needs the
                // caret and selection it was ranked for.
                if autocomplete, let field = self.inputField, let editor = field.fieldText,
                   Self.completionApplies(rankedFor: query, text: field.stringValue, selection: editor.selectedRange) {
                    self.input = self.model.completing(self.input, with: results)
                }
                self.render(self.model.rows(for: self.input, typedRows: results.rows))
                self.showSelection()
            }
        }
        pendingRank = work
        rankQueue.async(execute: work)
    }

    /// Drop the queued or in-flight ranking; its result will not render.
    private func cancelPendingRank() {
        pendingRank?.cancel()
        pendingRank = nil
        model.outdateRankings()
    }

    /// A completion applies only to the field state it was ranked for: the
    /// same text, caret at its end, nothing selected. Any edit, caret move or
    /// selection change since drops it (issue #41).
    static func completionApplies(rankedFor query: String, text: String, selection: NSRange) -> Bool {
        text == query && selection == NSRange(location: (query as NSString).length, length: 0)
    }

    /// Keyboard selection and Return act on the rows for what is typed now:
    /// if they are still being ranked, rank them here instead of acting on the
    /// previous query's rows. Clicks and hover act on the rows on screen.
    private func settleRows() {
        guard pendingRank != nil else { return }
        cancelPendingRank()
        render(model.rows(for: input))
    }

    /// Show `rows` and rebuild the stacked row views. A fresh open sends the
    /// selection back to the top; otherwise it is clamped to the new rows.
    private func render(_ rows: [PaletteRow], resetSelection: Bool = false) {
        currentRows = rows
        selection.rowsChanged(count: currentRows.count, resetSelection: resetSelection)
        rebuildRowViews()
        positionPanel()
        // Rows (and the panel) moved under a possibly parked pointer, which
        // fires no tracking event; hit-test it directly.
        syncHoverToPointer()
    }

    /// Show `Search ⇥` only while Tab has an action (a non-empty query).
    private func refreshTabHint() {
        let hint = model.tabAction(for: input.typed)?.hint
        tabHintLabel?.stringValue = hint ?? ""
        tabHintLabel?.isHidden = hint == nil
    }

    private func rebuildRowViews() {
        guard let stack = resultsStack else { return }
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }

        for (i, row) in currentRows.enumerated() {
            let rowView = PaletteRowView()
            rowView.configure(row, index: i)
            rowView.heightAnchor.constraint(equalToConstant: resultRowHeight).isActive = true
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
        refreshHighlights()
    }

    private func clickRow(_ idx: Int) {
        // A stale index must open nothing, not the previously selected row.
        guard currentRows.indices.contains(idx) else { return }
        selection.click(idx)
        refreshHighlights()
        activateSelection()
    }

    /// Hover follows the row actually under the pointer, read from the window
    /// rather than inferred from enter/exit events, so rebuilt rows, a resized
    /// panel, and a reopened palette all land on the truth. Visual only.
    /// PalettePanel also calls this while a press's tracking loop runs.
    func syncHoverToPointer() {
        var hovered: Int?
        if let panel, panel.isVisible, let stack = resultsStack {
            hovered = stack.rowIndex(atWindowPoint: panel.mouseLocationOutsideOfEventStream)
        }
        guard hovered != selection.hovered else { return }
        selection.hover(hovered)
        refreshHighlights()
    }

    // MARK: - Selection & activation

    private func moveSelection(_ direction: PaletteSelection.Direction) {
        selection.move(direction)
        refreshHighlights()
        showSelection()
    }

    private func refreshHighlights() {
        guard let stack = resultsStack else { return }
        for (i, view) in stack.arrangedSubviews.enumerated() {
            guard let rowView = view as? PaletteRowView, i < currentRows.count else { continue }
            let highlight = selection.highlight(for: i)
            rowView.setHighlight(highlight, hint: highlight == .selected ? selectedHint : nil)
        }
    }

    /// The hint names exactly what Return would do with the held modifiers.
    private var selectedHint: String? {
        returnAction(chord: currentReturnChord)?.hint
    }

    private func returnAction(chord: PaletteReturnChord) -> PaletteAction? {
        model.returnAction(for: input.typed, rows: currentRows,
                           selection: selection, chord: chord)
    }

    /// Resolve and open the current Return action. Mouse clicks use the plain
    /// chord; keyboard submission uses the current event's semantic chord.
    private func activateSelection(chord: PaletteReturnChord = .plain) {
        guard let action = returnAction(chord: chord) else { return }
        perform(action)
    }

    /// Run a resolved palette action: Settings, or open a lil and close.
    private func perform(_ action: PaletteAction) {
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
        refreshHighlights()
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
        if input.handle(selector, in: textView.string) {
            // Drop the selected remainder so the field reads as accepted.
            textView.setSelectedRange(NSRange(location: (textView.string as NSString).length, length: 0))
            queryDidChange()
            return true
        }
        switch selector {
        case #selector(NSResponder.insertNewline(_:)):
            settleRows()
            activateSelection(chord: returnChordOnCurrentEvent())
            return true
        case #selector(NSResponder.insertTab(_:)):
            // Tab searches the TYPED text (input.typed, never the inline
            // completion) whatever row is selected. Always consumed, so an
            // empty query keeps focus in the field instead of moving it to
            // the Settings/Close buttons.
            // verified: macOS 27.0.1, 2026-11-19 probe — plain Tab arrives here as
            // `insertTab:`; returning true leaves the field editor first
            // responder with its text unchanged.
            if let action = model.tabAction(for: input.typed) { perform(action) }
            return true
        case #selector(NSResponder.moveUp(_:)):
            settleRows()
            moveSelection(.up)
            return true
        case #selector(NSResponder.moveDown(_:)):
            settleRows()
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
        guard let field = inputField, let editor = field.fieldText else { return }
        // The editor has already moved the caret (see fieldSelectionDidChange).
        let pasted = (editor as? PaletteFieldEditor)?.isPasting ?? false
        queryDidChange(offeringCompletion: input.edit(to: field.stringValue, selection: editor.selectedRange,
                                                      pasted: pasted))
    }

    /// The query changed (an edit, or an accepted completion). The hint
    /// depends on the typed text alone, so it updates now, not when the rows
    /// land. The selection goes back to the top so Enter opens the best match;
    /// it resets now, while the new rows still rank: Return settles them
    /// first, and a history refresh landing meanwhile only clamps.
    private func queryDidChange(offeringCompletion: Bool = false) {
        refreshTabHint()
        selection.rowsChanged(count: currentRows.count, resetSelection: true)
        reload(autocomplete: offeringCompletion)
    }

    /// Make the field show the selected row: on the top row, the input with
    /// any completion's remainder SELECTED, so the next keystroke replaces it
    /// ("git" → "git[hub.com]"); on any other row, that row's preview. Writes
    /// only when the text differs, so an edit keeps the caret where it is.
    private func showSelection() {
        guard let field = inputField, let editor = field.fieldText else { return }
        // `selection` always counts `currentRows`, so a nonzero row exists.
        let row = selection.selected == 0 ? nil : currentRows[selection.selected]
        let display = input.display(previewing: row)
        guard editor.string != display.text else { return }
        isWritingField = true
        defer { isWritingField = false }
        field.stringValue = display.text
        editor.selectedRange = display.selection
    }

    /// →, ⌘→, End, or a click that drops the selected remainder accepts the
    /// completion: rows and hint recompute for the full field text. Reads the
    /// editor's current state, so it is correct whether AppKit posts this
    /// before or after the text-change callback of an edit.
    /// verified: typing over or deleting the selection posts this first, with
    /// the edited text (≠ `input.text`, so a no-op), then controlTextDidChange;
    /// moveRight: and moveToEndOfLine: post it with the text unchanged.
    @objc private func fieldSelectionDidChange(_ note: Notification) {
        guard !isWritingField,
              let editor = inputField?.fieldText,
              (note.object as AnyObject?) === editor,
              input.selectionDidChange(to: editor.selectedRange, in: editor.string)
        else { return }
        queryDidChange()
    }
}
