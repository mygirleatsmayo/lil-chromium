/// The palette's two row states, split so the pointer can never decide what
/// Return opens (#40):
///   - selected: the keyboard's row. Starts at the top, moves with ↑/↓, changes
///     on click. Return opens it.
///   - hovered: the row under the pointer. Visual only.
struct PaletteSelection {

    enum Highlight: Equatable {
        case none
        case hovered
        case selected
    }

    enum Direction { case up, down }

    private(set) var selected = 0
    private(set) var hovered: Int?
    private var rowCount = 0

    /// The list was rebuilt. A new query (or a fresh open) sends the selection
    /// back to the top; otherwise it is clamped. Hover is cleared: the caller
    /// re-reports the row under the pointer once the new rows are laid out.
    mutating func rowsChanged(count: Int, resetSelection: Bool) {
        rowCount = max(count, 0)
        selected = resetSelection ? 0 : min(selected, max(rowCount - 1, 0))
        hovered = nil
    }

    /// The row under the pointer, or nil when the pointer is off the list.
    mutating func hover(_ index: Int?) {
        hovered = index.flatMap { (0..<rowCount).contains($0) ? $0 : nil }
    }

    /// ↑/↓ with wraparound, always relative to the selected row.
    mutating func move(_ direction: Direction) {
        guard rowCount > 0 else { return }
        switch direction {
        case .up:   selected = (selected - 1 + rowCount) % rowCount
        case .down: selected = (selected + 1) % rowCount
        }
    }

    /// A click is the only pointer input that selects.
    mutating func click(_ index: Int) {
        guard (0..<rowCount).contains(index) else { return }
        selected = index
    }

    /// Selected wins over hovered, so the two highlights never add up.
    func highlight(for index: Int) -> Highlight {
        if index == selected, rowCount > 0 { return .selected }
        if index == hovered { return .hovered }
        return .none
    }
}
