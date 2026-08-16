import AppKit
import SwiftUI

/// One tint control, used for Lil Nap and hoverbar. Chips commit immediately;
/// the hex field is a draft and only commits a valid completed color.
/// `offersNoTint` is true for hoverbar; false for Lil Nap (`sleep.tint` always
/// has a color; graphite stands in when the bound value is nil).
struct TintEditor: View {
    @Binding var committed: String?
    var reloadToken: Int
    var label: String
    var offersNoTint: Bool

    @State private var model: TintEditorModel
    @ScaledMetric(relativeTo: .body) private var chipSize = 16.0

    init(
        committed: Binding<String?>,
        reloadToken: Int,
        label: String,
        offersNoTint: Bool = true
    ) {
        self._committed = committed
        self.reloadToken = reloadToken
        self.label = label
        self.offersNoTint = offersNoTint
        let initial = offersNoTint
            ? committed.wrappedValue
            : (committed.wrappedValue ?? TintPreset.graphite.hex)
        _model = State(initialValue: .seeded(from: initial))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .accessibilityHidden(true)
            chipRow
            if model.isCustom {
                TextField("Hex color", text: draftBinding, prompt: Text(verbatim: "#RRGGBB"))
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
            }
        }
        .accessibilityElement(children: .contain)
        .onChange(of: reloadToken) { _ in
            let value = offersNoTint ? committed : (committed ?? TintPreset.graphite.hex)
            model.seed(from: value)
        }
    }

    private var chipRow: some View {
        HStack(spacing: 6) {
            ForEach(TintChoice.ordered(offersNoTint: offersNoTint)) { choice in
                tintControl(for: choice)
            }
        }
        .focusSection()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }

    @ViewBuilder
    private func tintControl(for choice: TintChoice) -> some View {
        switch choice {
        case .custom:
            customWell
        case .none, .preset:
            chipButton(choice)
        }
    }

    private func chipButton(_ choice: TintChoice) -> some View {
        let selected = model.selectedChoice == choice
        return Button {
            model.select(choice)
            writeCommitted()
        } label: {
            chipSwatch(choice, selected: selected)
        }
        .buttonStyle(.plain)
        .help(choice.accessibilityLabel)
        .accessibilityLabel(choice.accessibilityLabel)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var customWell: some View {
        let selected = model.selectedChoice == .custom
        return TintColorWell(
            color: nsColor(from: model.committed ?? model.draft),
            isSelected: selected,
            onActivate: {
                model.select(.custom)
            },
            onColor: { nsColor in
                guard let hex = hexRGB(from: nsColor), hex != model.committed else { return }
                model.applyPickerHex(hex)
                writeCommitted()
            }
        )
        .frame(width: chipSize + 4, height: chipSize + 4)
        .overlay {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .strokeBorder(selected ? Color.primary : Color.clear, lineWidth: 2)
        }
        .help(TintChoice.custom.accessibilityLabel)
        .accessibilityLabel(TintChoice.custom.accessibilityLabel)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func chipSwatch(_ choice: TintChoice, selected: Bool) -> some View {
        ZStack {
            switch choice {
            case .none:
                Circle()
                    .fill(.background)
                Circle()
                    .strokeBorder(Color.secondary.opacity(0.6), lineWidth: 1)
                Capsule()
                    .fill(Color.secondary)
                    .frame(width: 1.5, height: chipSize * 0.7)
                    .rotationEffect(.degrees(-45))
            case .preset(let preset):
                Circle()
                    .fill(Color(nsColor: nsColor(from: preset.hex)))
            case .custom:
                EmptyView()
            }
        }
        .frame(width: chipSize, height: chipSize)
        .overlay {
            Circle()
                .strokeBorder(selected ? Color.primary : Color.secondary.opacity(0.35),
                              lineWidth: selected ? 2 : 1)
        }
        .accessibilityHidden(true)
    }

    private var draftBinding: Binding<String> {
        Binding(
            get: { model.draft },
            set: { newValue in
                model.applyDraft(newValue)
                writeCommitted()
            }
        )
    }

    /// Always assign. Lil Nap may display graphite for unusable `""`/`"none"`
    /// while `model.committed` is already that hex; the binding setter decides
    /// whether disk must change.
    private func writeCommitted() {
        committed = model.committed
    }
}

/// Native color well: clicking it opens NSColorPanel (eyedropper + hex in RGB sliders).
private struct TintColorWell: NSViewRepresentable {
    var color: NSColor
    var isSelected: Bool
    var onActivate: () -> Void
    var onColor: (NSColor) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> ActivateAwareColorWell {
        let well = ActivateAwareColorWell()
        well.colorWellStyle = .minimal
        well.isBordered = false
        well.color = color
        well.target = context.coordinator
        well.action = #selector(Coordinator.changed(_:))
        well.onActivate = { context.coordinator.onActivate() }
        return well
    }

    func updateNSView(_ well: ActivateAwareColorWell, context: Context) {
        context.coordinator.onActivate = onActivate
        context.coordinator.onColor = onColor
        well.onActivate = { context.coordinator.onActivate() }
        well.setAccessibilityLabel("Custom color")
        well.setAccessibilitySelected(isSelected)
        if hexRGB(from: well.color) != hexRGB(from: color) {
            well.color = color
        }
    }

    @MainActor
    final class Coordinator: NSObject {
        var onActivate: () -> Void = {}
        var onColor: (NSColor) -> Void = { _ in }

        @objc func changed(_ sender: NSColorWell) {
            onColor(sender.color)
        }
    }
}

@MainActor
private final class ActivateAwareColorWell: NSColorWell {
    var onActivate: (() -> Void)?

    override func activate(_ exclusive: Bool) {
        NSColorPanel.shared.showsAlpha = false
        super.activate(exclusive)
        onActivate?()
    }
}

private func nsColor(from hex: String?) -> NSColor {
    guard let hex, let normalized = TintHex.normalize(hex) else {
        return NSColor(srgbRed: 0.75, green: 0.75, blue: 0.78, alpha: 1)
    }
    let chars = Array(normalized)
    func component(_ start: Int) -> CGFloat {
        let pair = String(chars[start]) + String(chars[start + 1])
        return CGFloat(Int(pair, radix: 16) ?? 0) / 255
    }
    return NSColor(srgbRed: component(1), green: component(3), blue: component(5), alpha: 1)
}

private func hexRGB(from color: NSColor) -> String? {
    guard let rgb = color.usingColorSpace(.sRGB) else { return nil }
    func byte(_ value: CGFloat) -> Int {
        Int((min(max(value, 0), 1) * 255).rounded())
    }
    return String(
        format: "#%02x%02x%02x",
        byte(rgb.redComponent),
        byte(rgb.greenComponent),
        byte(rgb.blueComponent)
    )
}
