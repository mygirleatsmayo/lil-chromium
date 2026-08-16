import AppKit
import SwiftUI
import ServiceManagement
import LilShared

/// Liquid-glass mini Settings window (NSWindowController hosting a SwiftUI
/// Form). Opens on first run (onboarding), from the status item, and from the
/// menu bar's ⌘,. Skeleton adapted from research-v0.2.md §1.
///
/// Exactly one of these exists for the life of the process: the controller is
/// never dropped and the window is not released on close, so every entry point
/// reaches the same window.
@MainActor
final class SettingsWindowController: NSWindowController {
    private static var shared: SettingsWindowController?

    /// AppKit stores the frame under "NSWindow Frame <name>" in standard
    /// defaults once the user moves or resizes the window.
    private static let frameAutosaveName = "SettingsWindow"

    /// The store is held here so we can force a fresh config read every time the
    /// window is (re)shown — the host may have edited config.json (whitelist-op)
    /// while the window was closed OR merely hidden.
    private let store = SettingsStore()

    /// Show (creating if needed) the singleton Settings window. Always re-reads
    /// config.json + re-scans installed browsers so the form reflects current
    /// truth (e.g. a whitelist edited by the extension's context menus).
    ///
    /// Activating Lil Chromium is the only focus effect: no NSWorkspace open, no
    /// relay message, so showing Settings can never create or focus a normal
    /// browser window.
    static func show() {
        let controller = shared ?? SettingsWindowController()
        shared = controller
        controller.store.reload()
        controller.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private init() {
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: CGSize(width: 460, height: 560)),
            styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        super.init(window: window)
        window.title = "Lil Chromium Settings"
        window.toolbarStyle = .unified
        window.toolbar = NSToolbar() // empty toolbar enables the glass title bar
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: SettingsRoot(store: store))

        // verified: setFrameUsingName(_:) reads defaults directly and returns
        // false when nothing is stored, and setFrameAutosaveName(_:) does not
        // itself write a frame — but every frame change AFTER the name is set
        // does. So: restore the user's frame if one exists, otherwise do the
        // first-run placement, and only THEN start autosaving. That ordering is
        // what keeps our computed first position from masquerading as a frame
        // the user chose. (Probed on macOS 27, Xcode-beta toolchain.)
        if !window.setFrameUsingName(Self.frameAutosaveName) {
            Self.placeNearCenteredPalette(window)
        }
        window.setFrameAutosaveName(Self.frameAutosaveName)
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    /// First presentation: line the window up with where a centered palette
    /// would appear on the display the user is working on, instead of letting
    /// AppKit drop it against a screen edge.
    private static func placeNearCenteredPalette(_ window: NSWindow) {
        guard let screen = PalettePlacement.activeScreen else { return }
        window.setFrameOrigin(
            PalettePlacement.centeredOrigin(forSize: window.frame.size, on: screen)
        )
    }
}

// MARK: - Config store (ObservableObject)

/// Observable wrapper around LilConfig. Loads on init, re-scans installed
/// browsers, and saves to config.json on every change. @AppStorage cannot be
/// used because the config lives in a JSON file (which the host also writes),
/// not UserDefaults — so we always read the file fresh, never cache in defaults.
@MainActor
final class SettingsStore: ObservableObject {
    /// Persisting is suppressed while `reload()` swaps in a fresh disk copy, so
    /// re-reading the file never immediately writes it straight back.
    private var suppressSave = false

    /// Bumped by every `reload()`. Views observe it to re-seed local editing
    /// buffers when the singleton window is presented again — `onAppear` only
    /// fires once for a window that is never torn down.
    @Published private(set) var reloadToken = 0

    @Published var config: LilConfig {
        didSet {
            guard !suppressSave else { return }
            config.save()  // atomic, unknown-field-preserving (see ConfigMerge)
        }
    }

    init() {
        // Load current config, merge a fresh browser scan, and persist so the
        // pickers and downstream readers agree.
        let scanned = BrowserCatalog.merged(into: LilConfig.load())
        self.config = scanned
        scanned.save()
    }

    /// Re-read config.json from disk (the host may have edited it) and re-scan
    /// installed browsers. Called every time the Settings window is shown. The
    /// swap itself does not trigger a save.
    func reload() {
        suppressSave = true
        config = BrowserCatalog.merged(into: LilConfig.load())
        suppressSave = false
        reloadToken += 1
    }

    /// Browsers Launch Services could resolve — the only valid picker choices.
    var installedBrowsers: [KnownBrowser] {
        config.knownBrowsers.filter { $0.installed }
    }

    /// True when the chosen default browser is not currently installed (drives
    /// the Settings warning indicator).
    var defaultBrowserMissing: Bool {
        !BrowserCatalog.isInstalled(config.defaultBrowser, in: config)
    }

    // Launch-at-Login (SMAppService). Reflects the real system state.
    var launchAtLogin: Bool {
        get { SMAppService.mainApp.status == .enabled }
        set {
            do {
                if newValue {
                    try SMAppService.mainApp.register()
                } else {
                    try SMAppService.mainApp.unregister()
                }
            } catch {
                NSLog("lil-chromium: launch-at-login toggle failed: \(error)")
            }
            objectWillChange.send()
        }
    }
}

// MARK: - Search-engine presets

/// The built-in search presets offered in Settings. A template of "" marks the
/// "Custom" sentinel (the user then supplies their own template).
private struct SearchPreset: Identifiable {
    let id: String        // stable tag
    let name: String
    let template: String  // "" => Custom
    var isCustom: Bool { template.isEmpty }
}

private let searchPresets: [SearchPreset] = [
    SearchPreset(id: "google", name: "Google", template: "https://www.google.com/search?q=%s"),
    SearchPreset(id: "ddg", name: "DuckDuckGo", template: "https://duckduckgo.com/?q=%s"),
    SearchPreset(id: "bing", name: "Bing", template: "https://www.bing.com/search?q=%s"),
    SearchPreset(id: "kagi", name: "Kagi", template: "https://kagi.com/search?q=%s"),
    SearchPreset(id: "custom", name: "Custom", template: ""),
]

// MARK: - SwiftUI pane

struct SettingsRoot: View {
    @ObservedObject var store: SettingsStore

    // Local editing state for the sleep whitelist add field.
    @State private var newWhitelistDomain: String = ""
    // Local editing buffer for a custom search template; validated (must contain
    // %s) before it is written back to config.
    @State private var customSearchTemplate: String = ""

    var body: some View {
        // Three sections, in the order the parent spec fixes them: General
        // (what Lil Chromium itself does), Lils (what a lil does), Hoverbar
        // (how a lil's overlay looks).
        Form {
            generalSection
            lilsSection
            hoverbarSection
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .frame(minWidth: 440, minHeight: 520)
        .onAppear {
            // Seed the custom-template buffer from whatever is stored so the
            // Custom field shows the current value when the window opens.
            customSearchTemplate = store.config.searchEngine.template
        }
        // The window is a long-lived singleton, so onAppear fires once per
        // process. Re-seed the buffer on each reload — i.e. each time Settings
        // is presented again with fresh disk truth — and never while typing.
        .onChange(of: store.reloadToken) { _ in
            customSearchTemplate = store.config.searchEngine.template
        }
    }

    // MARK: General

    private var generalSection: some View {
        Section("General") {
            Picker(selection: primaryBrowserBinding) {
                ForEach(store.installedBrowsers, id: \.slug) { b in
                    Text(b.name).tag(b.slug)
                }
            } label: {
                HStack(spacing: 6) {
                    Text("Primary browser")
                    if store.defaultBrowserMissing {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.yellow)
                            .help("The selected Primary browser isn't installed.")
                    }
                }
            }

            Picker("Fallback browser", selection: fallbackBrowserBinding) {
                ForEach(store.installedBrowsers, id: \.slug) { b in
                    Text(b.name).tag(b.slug)
                }
            }

            Picker("Palette position", selection: paletteAnchorBinding) {
                Text("Centered near top").tag("top-center")
                Text("Top right").tag("top-right")
            }

            searchControls

            Toggle("Launch at Login", isOn: launchAtLoginBinding)
        }
    }

    // MARK: Lils

    private var lilsSection: some View {
        Section("Lils") {
            Picker("New-window links", selection: linkBehaviorBinding) {
                Text("Open in a new lil (default)").tag("new-lil")
                Text("Open in the same lil").tag("same-lil")
            }
            if store.config.linkBehavior == "same-lil" {
                Text("Opening in the same lil can break some sign-in popups.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text("Hold ⌘ when clicking a link for the other behavior.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Picker("Close lils automatically", selection: ephemeralBinding) {
                Text("Never").tag("never")
                Text("After 6 hours idle").tag("6h")
                Text("After 12 hours").tag("12h")
                Text("After 24 hours").tag("24h")
                Text("When browser quits").tag("quit")
            }

            sleepControls
        }
    }

    // MARK: Sleep (inside Lils)

    @ViewBuilder private var sleepControls: some View {
        Toggle("Put idle lils to sleep", isOn: sleepEnabledBinding)
        Text("Sleeping frees the page’s memory; click a sleeping lil to wake it.")
            .font(.caption)
            .foregroundStyle(.secondary)

        // Only expose the detail controls when sleep is enabled.
        if store.config.sleep.enabled {
            Picker("Sleep after", selection: sleepMinutesBinding) {
                Text("15 minutes").tag(15)
                Text("30 minutes").tag(30)
                Text("60 minutes").tag(60)
                Text("120 minutes").tag(120)
            }
            Toggle("Don’t sleep lils playing audio", isOn: audioGuardBinding)
            Toggle("Don’t sleep lils with unsaved form input", isOn: formGuardBinding)

            sleepTintControls
            whitelistEditor
        }
    }

    /// Tint picker (Purple / Gray / Custom hex). "Custom" reveals a hex field.
    @ViewBuilder private var sleepTintControls: some View {
        Picker("Sleep tint", selection: sleepTintKindBinding) {
            Text("Purple").tag("purple")
            Text("Gray").tag("gray")
            Text("Custom").tag("custom")
        }
        if sleepTintKindBinding.wrappedValue == "custom" {
            TextField("#RRGGBB", text: sleepTintHexBinding)
                .textFieldStyle(.roundedBorder)
        }
    }

    /// Domain whitelist: a list with per-row delete (minus button — macOS has no
    /// reliable swipe-to-delete) plus a TextField + Add. Domains normalized to a
    /// bare lowercased host on add.
    @ViewBuilder private var whitelistEditor: some View {
        let domains = store.config.sleep.whitelist
        if !domains.isEmpty {
            ForEach(domains, id: \.self) { domain in
                HStack {
                    Text(domain)
                    Spacer()
                    Button {
                        removeWhitelistDomain(domain)
                    } label: {
                        Image(systemName: "minus.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.borderless)
                    .help("Remove \(domain) from the whitelist")
                }
            }
        }
        HStack {
            TextField("Add domain (never sleep)", text: $newWhitelistDomain)
                .textFieldStyle(.roundedBorder)
                .onSubmit { addWhitelistDomain() }
            Button("Add") { addWhitelistDomain() }
                .disabled(ConfigMerge.normalizedDomain(newWhitelistDomain).isEmpty)
        }
    }

    // MARK: Search (inside General)

    @ViewBuilder private var searchControls: some View {
        Picker("Search engine", selection: searchPresetBinding) {
            ForEach(searchPresets) { preset in
                Text(preset.name).tag(preset.id)
            }
        }
        if searchPresetBinding.wrappedValue == "custom" {
            VStack(alignment: .leading, spacing: 4) {
                TextField("https://example.com/search?q=%s", text: $customSearchTemplate)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { commitCustomTemplate() }
                    .onChange(of: customSearchTemplate) { newValue in
                        commitCustomTemplate(newValue)
                    }
                if !customSearchTemplate.contains("%s") {
                    Text("Template must contain %s (replaced by the query).")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
    }

    // MARK: Hoverbar

    private var hoverbarSection: some View {
        Section("Hoverbar") {
            Picker("Style", selection: hoverStyleBinding) {
                Text("Glass").tag("glass")
                Text("Solid").tag("solid")
            }
            Picker("Tint", selection: hoverTintKindBinding) {
                Text("None").tag("none")
                Text("Custom").tag("custom")
            }
            if hoverTintKindBinding.wrappedValue == "custom" {
                TextField("#RRGGBB", text: hoverTintHexBinding)
                    .textFieldStyle(.roundedBorder)
            }
        }
    }

    // MARK: - Whitelist mutation helpers

    private func addWhitelistDomain() {
        let host = ConfigMerge.normalizedDomain(newWhitelistDomain)
        guard !host.isEmpty else { return }
        var list = store.config.sleep.whitelist
        guard !list.contains(host) else { newWhitelistDomain = ""; return }
        list.append(host)
        store.config.sleep.whitelist = list
        newWhitelistDomain = ""
    }

    private func removeWhitelistDomain(_ domain: String) {
        store.config.sleep.whitelist.removeAll { $0 == domain }
    }

    // MARK: - Search template commit (validated)

    /// Write the custom template back to config only when it contains "%s".
    private func commitCustomTemplate(_ value: String? = nil) {
        let tmpl = (value ?? customSearchTemplate).trimmingCharacters(in: .whitespacesAndNewlines)
        guard tmpl.contains("%s") else { return }  // invalid — keep last good value
        if store.config.searchEngine.template != tmpl {
            store.config.searchEngine.template = tmpl
            store.config.searchEngine.name = "Custom"
        }
    }

    // MARK: - Bindings (route through store.config so didSet -> save())

    private var primaryBrowserBinding: Binding<String> {
        Binding(get: { store.config.defaultBrowser },
                set: { store.config.defaultBrowser = $0 })
    }
    private var fallbackBrowserBinding: Binding<String> {
        Binding(get: { store.config.fallbackBrowser },
                set: { store.config.fallbackBrowser = $0 })
    }
    private var paletteAnchorBinding: Binding<String> {
        Binding(get: { store.config.paletteAnchor },
                set: { store.config.paletteAnchor = $0 })
    }
    private var linkBehaviorBinding: Binding<String> {
        Binding(get: { store.config.linkBehavior },
                set: { store.config.linkBehavior = $0 })
    }
    private var ephemeralBinding: Binding<String> {
        Binding(get: { store.config.ephemeralDefault },
                set: { store.config.ephemeralDefault = $0 })
    }
    private var launchAtLoginBinding: Binding<Bool> {
        Binding(get: { store.launchAtLogin },
                set: { store.launchAtLogin = $0 })
    }

    // Sleep bindings.
    private var sleepEnabledBinding: Binding<Bool> {
        Binding(get: { store.config.sleep.enabled },
                set: { store.config.sleep.enabled = $0 })
    }
    private var sleepMinutesBinding: Binding<Int> {
        Binding(get: { store.config.sleep.afterMinutes },
                set: { store.config.sleep.afterMinutes = $0 })
    }
    private var audioGuardBinding: Binding<Bool> {
        Binding(get: { store.config.sleep.audioGuard },
                set: { store.config.sleep.audioGuard = $0 })
    }
    private var formGuardBinding: Binding<Bool> {
        Binding(get: { store.config.sleep.formGuard },
                set: { store.config.sleep.formGuard = $0 })
    }

    /// Maps the stored tint string onto the three-way picker: "purple"/"gray"
    /// are literal; anything else (a #hex) reads as "custom".
    private var sleepTintKindBinding: Binding<String> {
        Binding(
            get: {
                let t = store.config.sleep.tint
                return (t == "purple" || t == "gray") ? t : "custom"
            },
            set: { kind in
                switch kind {
                case "purple": store.config.sleep.tint = "purple"
                case "gray": store.config.sleep.tint = "gray"
                default:
                    // Switching to custom: seed with the current value if it's a
                    // hex, else a sensible default.
                    let t = store.config.sleep.tint
                    store.config.sleep.tint = t.hasPrefix("#") ? t : "#7C5CFF"
                }
            }
        )
    }
    private var sleepTintHexBinding: Binding<String> {
        Binding(get: { store.config.sleep.tint },
                set: { store.config.sleep.tint = $0 })
    }

    // Search preset binding: maps the stored template onto a preset id, and on
    // set copies the preset's template into config (Custom keeps the current
    // template and lets the TextField drive it).
    private var searchPresetBinding: Binding<String> {
        Binding(
            get: {
                let tmpl = store.config.searchEngine.template
                return searchPresets.first(where: { $0.template == tmpl })?.id ?? "custom"
            },
            set: { id in
                guard let preset = searchPresets.first(where: { $0.id == id }) else { return }
                if preset.isCustom {
                    // Leave the template as-is; the Custom field takes over.
                    store.config.searchEngine.name = "Custom"
                    customSearchTemplate = store.config.searchEngine.template
                } else {
                    store.config.searchEngine.name = preset.name
                    store.config.searchEngine.template = preset.template
                    customSearchTemplate = preset.template
                }
            }
        )
    }

    // Hover-bar bindings.
    private var hoverStyleBinding: Binding<String> {
        Binding(get: { store.config.hoverBar.style },
                set: { store.config.hoverBar.style = $0 })
    }
    private var hoverTintKindBinding: Binding<String> {
        Binding(
            get: { store.config.hoverBar.tint == nil ? "none" : "custom" },
            set: { kind in
                if kind == "none" {
                    store.config.hoverBar.tint = nil
                } else {
                    store.config.hoverBar.tint = store.config.hoverBar.tint ?? "#7C5CFF"
                }
            }
        )
    }
    private var hoverTintHexBinding: Binding<String> {
        Binding(
            get: { store.config.hoverBar.tint ?? "" },
            set: { store.config.hoverBar.tint = $0.isEmpty ? nil : $0 }
        )
    }
}
