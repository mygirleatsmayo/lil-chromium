import AppKit
import Carbon.HIToolbox
import ServiceManagement
import LilShared

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
            forEventID: AEEventID(kAEGetURL)
        )
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        LilPaths.ensureStateDir()
        setupStatusItem()
        registerHotKey()
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
            title: "New Little Window",
            action: #selector(showPalette),
            keyEquivalent: "n"
        )
        newWindow.keyEquivalentModifierMask = [.command, .option]
        newWindow.target = self
        menu.addItem(newWindow)

        let setDefault = NSMenuItem(
            title: "Set as Default Browser…",
            action: #selector(setAsDefaultBrowser),
            keyEquivalent: ""
        )
        setDefault.target = self
        menu.addItem(setDefault)

        let launchLogin = NSMenuItem(
            title: "Launch at Login",
            action: #selector(toggleLaunchAtLogin(_:)),
            keyEquivalent: ""
        )
        launchLogin.target = self
        launchLogin.state = launchAtLoginEnabled ? .on : .off
        menu.addItem(launchLogin)

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

    @objc private func showPalette() {
        palette.show()
    }

    @objc private func quit() {
        GlobalHotKey.shared.unregister()
        NSApp.terminate(nil)
    }

    @objc private func setAsDefaultBrowser() {
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

    // MARK: - Launch at Login (SMAppService, verified)

    private var launchAtLoginEnabled: Bool {
        SMAppService.mainApp.status == .enabled
    }

    @objc private func toggleLaunchAtLogin(_ sender: NSMenuItem) {
        do {
            if launchAtLoginEnabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            NSLog("lil-chromium: launch-at-login toggle failed: \(error)")
        }
        // Reflect the real system state (register can require approval).
        sender.state = launchAtLoginEnabled ? .on : .off
    }

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
