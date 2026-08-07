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
