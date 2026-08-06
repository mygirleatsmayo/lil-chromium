import AppKit

enum SearchFieldArrow {
    case up
    case down
}

/// The palette's input field. A plain borderless NSTextField that intercepts
/// arrow keys, Return, and Escape via the field editor's doCommandBy(selector:)
/// hook so we can drive selection/activation without a separate event monitor.
final class PaletteSearchField: NSTextField {

    var onArrow: ((SearchFieldArrow) -> Void)?
    var onSubmit: (() -> Void)?
    var onCancel: (() -> Void)?

    /// The field editor forwards unhandled commands here. We hijack the ones we
    /// care about and let everything else proceed normally.
    override func doCommand(by selector: Selector) {
        switch selector {
        case #selector(NSResponder.moveUp(_:)):
            onArrow?(.up)
        case #selector(NSResponder.moveDown(_:)):
            onArrow?(.down)
        case #selector(NSResponder.insertNewline(_:)):
            onSubmit?()
        case #selector(NSResponder.cancelOperation(_:)):
            onCancel?()
        default:
            super.doCommand(by: selector)
        }
    }
}
