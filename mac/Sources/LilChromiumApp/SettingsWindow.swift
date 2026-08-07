import AppKit
import SwiftUI
import ServiceManagement
import LilShared

/// Liquid-glass mini Settings window (NSWindowController hosting a SwiftUI
/// Form). Opens on first run (onboarding) and from the menu. Skeleton adapted
/// from research-v0.2.md §1.
@MainActor
final class SettingsWindowController: NSWindowController, NSWindowDelegate {
    private static var shared: SettingsWindowController?

    /// Show (creating if needed) the singleton Settings window. Re-scans the
    /// browser catalog so the pickers reflect what is currently installed.
    static func show() {
        if shared == nil { shared = SettingsWindowController() }
        shared?.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private init() {
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: CGSize(width: 460, height: 420)),
            styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        super.init(window: window)
        window.title = "lil-chromium Settings"
        window.toolbarStyle = .unified
        window.toolbar = NSToolbar() // empty toolbar enables the glass title bar
        window.setFrameAutosaveName("SettingsWindow")
        window.center()
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: SettingsRoot())
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    func windowWillClose(_ notification: Notification) {
        Self.shared = nil
    }
}

// MARK: - Config store (ObservableObject)

/// Observable wrapper around LilConfig. Loads on init, re-scans installed
/// browsers, and saves to config.json on every change. @AppStorage cannot be
/// used because the config lives in a JSON file, not UserDefaults.
@MainActor
final class SettingsStore: ObservableObject {
    @Published var config: LilConfig {
        didSet { config.save() }
    }

    init() {
        // Load current config, merge a fresh browser scan, and persist so the
        // pickers and downstream readers agree.
        let scanned = BrowserCatalog.merged(into: LilConfig.load())
        self.config = scanned
        scanned.save()
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

// MARK: - SwiftUI pane

struct SettingsRoot: View {
    @StateObject private var store = SettingsStore()

    var body: some View {
        Form {
            Section {
                Picker(selection: primaryBrowserBinding) {
                    ForEach(store.installedBrowsers, id: \.slug) { b in
                        Text(b.name).tag(b.slug)
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text("Primary browser")
                        if store.defaultBrowserMissing {
                            // Warning dot: chosen default is not installed.
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.yellow)
                                .help("The selected primary browser isn't installed.")
                        }
                    }
                }

                Picker("Fallback browser", selection: fallbackBrowserBinding) {
                    ForEach(store.installedBrowsers, id: \.slug) { b in
                        Text(b.name).tag(b.slug)
                    }
                }
            }

            Section {
                Picker("Palette position", selection: paletteAnchorBinding) {
                    Text("Centered near top").tag("top-center")
                    Text("Top right").tag("top-right")
                }

                Picker("Links in lils", selection: linkBehaviorBinding) {
                    Text("Open in the same lil").tag("same-lil")
                    Text("Open in a new lil").tag("new-lil")
                }
                Text("Hold ⌘ when clicking a link for the other behavior.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                Toggle("Launch at Login", isOn: launchAtLoginBinding)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .frame(minWidth: 420, minHeight: 380)
    }

    // Bindings that route reads/writes through the store's published config so
    // every change triggers didSet -> save().

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
    private var launchAtLoginBinding: Binding<Bool> {
        Binding(get: { store.launchAtLogin },
                set: { store.launchAtLogin = $0 })
    }
}
