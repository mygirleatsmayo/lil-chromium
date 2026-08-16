import Foundation

/// One swatch in the shared tint editor, in display order: no tint (hoverbar
/// only), the eight conventional macOS accent colors, then custom.
enum TintChoice: Hashable, Identifiable {
    case none
    case preset(TintPreset)
    case custom

    var id: String {
        switch self {
        case .none: return "none"
        case .preset(let preset): return preset.rawValue
        case .custom: return "custom"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .none: return "No tint"
        case .preset(let preset): return preset.accessibilityLabel
        case .custom: return "Custom color"
        }
    }

    /// Hoverbar order: no tint; blue…graphite; custom. Lil Nap omits no-tint
    /// (`sleep.tint` is never empty; graphite is the neutral chip).
    static let ordered: [TintChoice] = [.none] + TintPreset.allCases.map { .preset($0) } + [.custom]

    static func ordered(offersNoTint: Bool) -> [TintChoice] {
        offersNoTint ? ordered : ordered.filter { $0 != .none }
    }
}

/// macOS accent-color presets, in the conventional picker order.
enum TintPreset: String, CaseIterable, Identifiable {
    case blue, purple, pink, red, orange, yellow, green, graphite

    var id: String { rawValue }

    var accessibilityLabel: String {
        switch self {
        case .blue: return "Blue"
        case .purple: return "Purple"
        case .pink: return "Pink"
        case .red: return "Red"
        case .orange: return "Orange"
        case .yellow: return "Yellow"
        case .green: return "Green"
        case .graphite: return "Graphite"
        }
    }

    /// Stable sRGB hex (light-mode system colors). Dynamic `NSColor.system*`
    /// values shift with appearance and would not round-trip.
    var hex: String {
        switch self {
        case .blue: return "#007aff"
        case .purple: return "#af52de"
        case .pink: return "#ff2d55"
        case .red: return "#ff3b30"
        case .orange: return "#ff9500"
        case .yellow: return "#ffcc00"
        case .green: return "#34c759"
        case .graphite: return "#8e8e93"
        }
    }

    static func matching(hex: String) -> TintPreset? {
        allCases.first { $0.hex == hex }
    }
}

/// `#rgb` / `#rrggbb` → normalized `#rrggbb`. Anything else is not a completed color.
enum TintHex {
    static func normalize(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("#") else { return nil }
        var digits = String(trimmed.dropFirst())
        if digits.count == 3, digits.allSatisfy(\.isHexDigit) {
            digits = digits.map { "\($0)\($0)" }.joined()
        }
        guard digits.count == 6, digits.allSatisfy(\.isHexDigit) else { return nil }
        return "#" + digits.lowercased()
    }
}

/// Maps the editor's optional committed hex onto each config field.
///
/// Hoverbar: PROTOCOL optional `#rrggbb` (nil = no tint, omitted on write).
/// Lil Nap: PROTOCOL `sleep.tint` is `"gray"|"purple"|#rrggbb` — never empty.
/// Named tokens still *display* as chips; new commits write `#rrggbb`.
/// Unusable `""`/`"none"` are not graphite (`committedHex` is nil); Settings
/// shows graphite and a graphite commit writes `#8e8e93`. A missing commit
/// stores graphite, the editor's remaining neutral chip.
enum TintValue {
    /// PROTOCOL tokens become chips. `""`/`"none"` are unusable, not graphite.
    static func committedHex(fromSleep stored: String) -> String? {
        let trimmed = stored.trimmingCharacters(in: .whitespacesAndNewlines)
        switch trimmed.lowercased() {
        case "", "none": return nil
        case "purple": return TintPreset.purple.hex
        case "gray", "grey": return TintPreset.graphite.hex
        default: return TintHex.normalize(trimmed) ?? trimmed
        }
    }

    /// Next `sleep.tint` to persist, or nil to leave disk unchanged.
    /// PROTOCOL tokens that already display as `hex` must not be rewritten.
    /// Unusable `""`/`"none"` do not skip a graphite commit.
    static func sleepTintIfChanged(from stored: String, committing hex: String?) -> String? {
        let current = committedHex(fromSleep: stored)
        let next = sleepStorage(fromCommitted: hex)
        guard current != committedHex(fromSleep: next) else { return nil }
        return next
    }

    static func sleepStorage(fromCommitted hex: String?) -> String {
        guard let hex, !hex.isEmpty else { return TintPreset.graphite.hex }
        return TintHex.normalize(hex) ?? hex
    }

    static func committedHex(fromHoverBar stored: String?) -> String? {
        guard let stored else { return nil }
        let trimmed = stored.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        return TintHex.normalize(trimmed) ?? trimmed
    }

    static func hoverBarStorage(fromCommitted hex: String?) -> String? {
        hex.flatMap { TintHex.normalize($0) } ?? hex
    }
}

/// Draft text is local; `committed` is the optional color written to config.
/// Empty, partial, and invalid drafts stay in `draft` and never clear `committed`.
struct TintEditorModel: Equatable {
    var committed: String?
    var draft: String
    var isCustom: Bool

    var selectedChoice: TintChoice {
        if isCustom { return .custom }
        guard let committed else { return .none }
        if let preset = TintPreset.matching(hex: committed) { return .preset(preset) }
        return .custom
    }

    static func seeded(from committed: String?) -> TintEditorModel {
        var model = TintEditorModel(committed: nil, draft: "", isCustom: false)
        model.seed(from: committed)
        return model
    }

    mutating func seed(from committed: String?) {
        let normalized = committed.flatMap { TintHex.normalize($0) } ?? committed
        self.committed = normalized.flatMap { $0.isEmpty ? nil : $0 }
        if let hex = self.committed, TintHex.normalize(hex) != nil {
            draft = hex
            isCustom = TintPreset.matching(hex: hex) == nil
        } else if let raw = self.committed {
            draft = raw
            isCustom = true
        } else {
            draft = ""
            isCustom = false
        }
    }

    mutating func select(_ choice: TintChoice) {
        switch choice {
        case .none:
            isCustom = false
            committed = nil
            draft = ""
        case .preset(let preset):
            isCustom = false
            committed = preset.hex
            draft = preset.hex
        case .custom:
            isCustom = true
            if let committed, TintHex.normalize(committed) != nil {
                draft = committed
            }
        }
    }

    /// Always keeps `draft`. Commits only a valid completed color.
    mutating func applyDraft(_ text: String) {
        isCustom = true
        draft = text
        if let hex = TintHex.normalize(text) {
            committed = hex
        }
    }

    mutating func applyPickerHex(_ hex: String) {
        guard let normalized = TintHex.normalize(hex) else { return }
        isCustom = true
        committed = normalized
        draft = normalized
    }
}
