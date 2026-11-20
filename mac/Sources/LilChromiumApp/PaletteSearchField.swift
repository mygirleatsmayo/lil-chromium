import AppKit

/// The palette's input field: a plain borderless single-line NSTextField.
///
/// Key/selection handling lives in the controller's
/// `control(_:textView:doCommandBySelector:)` (the verified pattern), NOT here —
/// that method can `return true` to consume a command and SUPPRESS the field
/// editor's default (which is what stops Enter from select-all'ing, the v0.1
/// bug). This subclass only carries configuration and a couple of conveniences.
final class PaletteSearchField: NSTextField {

    /// Configure as a borderless, single-line, transparent search input. The
    /// controller pins this with `centerYAnchor` inside the 56pt input row so
    /// the text is vertically centered (the v0.1 top-justify bug), rather than
    /// subclassing NSTextFieldCell.
    func configureAsPaletteInput() {
        isBezeled = false
        isBordered = false
        drawsBackground = false
        focusRingType = .none
        font = .systemFont(ofSize: 20, weight: .regular)
        placeholderString = "Search or enter URL…"
        lineBreakMode = .byTruncatingTail
        usesSingleLineMode = true
        cell?.wraps = false
        cell?.isScrollable = true
        maximumNumberOfLines = 1
        translatesAutoresizingMaskIntoConstraints = false
    }

    /// The live field editor as an NSText (for inline autocomplete selection).
    /// `currentEditor()` returns nil when the field isn't first responder.
    var fieldText: NSText? { currentEditor() }
}

/// The palette field's editor. It reports a paste in progress, because Chrome
/// never completes a pasted edit inline (`OmniboxEditModel::OnPaste`).
/// `PalettePanel` hands it to the search field.
@MainActor
final class PaletteFieldEditor: NSTextView {

    /// True while a paste command edits the text, which includes the text
    /// change it posts.
    /// verified: macOS 27.0.1, 2026-11-20 probe — `paste:` posts
    /// controlTextDidChange before it returns, caret already after the paste.
    private(set) var isPasting = false

    override func paste(_ sender: Any?) { pasting { super.paste(sender) } }
    override func pasteAsPlainText(_ sender: Any?) { pasting { super.pasteAsPlainText(sender) } }
    override func pasteAsRichText(_ sender: Any?) { pasting { super.pasteAsRichText(sender) } }

    private func pasting(_ paste: () -> Void) {
        isPasting = true
        defer { isPasting = false }
        paste()
    }
}
