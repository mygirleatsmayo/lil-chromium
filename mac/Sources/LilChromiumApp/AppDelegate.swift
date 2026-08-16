import AppKit
import Carbon.HIToolbox
import LilShared

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem?
    private let palette = PaletteController()

    // Dedupe: default-browser opens may arrive via BOTH application(_:open:)
    // and the kAEGetURL Apple Event. Collapse duplicates by URL within 300ms.
    private var lastOpenedURL: String?
    private var lastOpenedAt: Date = .distantPast

    // MARK: - Apple Event registration (must be in willFinishLaunching)

    func applicationWillFinishLaunching(_ notification: Notification) {
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleGetURLEvent(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        LilPaths.ensureStateDir()

        // First-run detection must happen BEFORE we scan+write config, since
        // the scan creates config.json.
        let isFirstRun = !LilConfig.fileExists

        // Scan installed browsers, merge into config (preserving user choices),
        // and persist so hosts/extension see current truth.
        let merged = BrowserCatalog.merged(into: LilConfig.load())
        merged.save()

        // Install the menu bar BEFORE anything can take focus: it is what makes
        // ⌘, and the standard Edit commands work at all (see MainMenu).
        NSApp.mainMenu = MainMenu.make(target: self)

        setupStatusItem()
        registerHotKey()

        // First launch with no config: open Settings for onboarding.
        if isFirstRun {
            SettingsWindowController.show()
        }
    }

    // MARK: - Status item / menu

    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            // SF Symbol; falls back gracefully if unavailable.
            button.image = NSImage(systemSymbolName: "sparkle",
                                   accessibilityDescription: "lil-chromium")
            button.image?.isTemplate = true
        }

        let menu = NSMenu()

        let newWindow = NSMenuItem(
            title: "New Lil",
            action: #selector(showPalette),
            keyEquivalent: "n"
        )
        newWindow.keyEquivalentModifierMask = [.command, .option]
        newWindow.target = self
        menu.addItem(newWindow)

        let settings = NSMenuItem(
            title: "Settings…",
            action: #selector(showSettings),
            keyEquivalent: ","
        )
        settings.keyEquivalentModifierMask = [.command]
        settings.target = self
        menu.addItem(settings)

        let setDefault = NSMenuItem(
            title: "Set as Default Browser…",
            action: #selector(setAsDefaultBrowser),
            keyEquivalent: ""
        )
        setDefault.target = self
        menu.addItem(setDefault)

        menu.addItem(.separator())

        let quit = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        item.menu = menu
        self.statusItem = item
    }

    // MARK: - Hotkey

    private func registerHotKey() {
        GlobalHotKey.shared.register { [weak self] in
            // Carbon dispatches on the main run loop; hop to main to be safe.
            DispatchQueue.main.async { self?.palette.toggle() }
        }
    }

    // MARK: - Menu actions
    //
    // The ones the application menu bar also targets are internal rather than
    // private, so MainMenu can name them.

    @objc private func showPalette() {
        palette.show()
    }

    @objc func showSettings() {
        // The palette is a floating panel and would sit on top of Settings, so
        // dismiss it first: the two surfaces must never compete for focus.
        palette.close()
        SettingsWindowController.show()
    }

    @objc func quit() {
        GlobalHotKey.shared.unregister()
        NSApp.terminate(nil)
    }

    @objc func setAsDefaultBrowser() {
        // Verified: NSWorkspace.setDefaultApplication(at:toOpenURLsWithScheme:)
        // is async/throws on macOS 12+. Only "http" is needed (setting "https"
        // typically errors); the system shows a confirmation dialog.
        let bundleURL = Bundle.main.bundleURL
        // Verified label is `completion:` (not `completionHandler:`) for this
        // overload on macOS 12+.
        NSWorkspace.shared.setDefaultApplication(
            at: bundleURL,
            toOpenURLsWithScheme: "http",
            completion: { error in
                if let error = error {
                    NSLog("lil-chromium: setDefaultApplication(http) failed: \(error)")
                }
            }
        )
    }

    // Launch-at-Login (SMAppService) now lives in the Settings window
    // (SettingsStore.launchAtLogin).

    // MARK: - URL intake

    /// Finder / file-based and some URL opens arrive here.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            handleIncomingURL(url.absoluteString)
        }
    }

    /// The canonical default-browser path: kInternetEventClass / kAEGetURL.
    @objc func handleGetURLEvent(_ event: NSAppleEventDescriptor,
                                 withReplyEvent reply: NSAppleEventDescriptor) {
        guard let urlString = event
            .paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?
            .stringValue else { return }
        handleIncomingURL(urlString)
    }

    /// Central intake: dedupe, then route (relay-first, Chrome fallback), always
    /// anchored to the current mouse position.
    private func handleIncomingURL(_ urlString: String) {
        let now = Date()
        if urlString == lastOpenedURL,
           now.timeIntervalSince(lastOpenedAt) < 0.3 {
            return // duplicate within 300ms
        }
        lastOpenedURL = urlString
        lastOpenedAt = now

        OpenRouter.openAnchoredToMouse(urlString)
    }
}
