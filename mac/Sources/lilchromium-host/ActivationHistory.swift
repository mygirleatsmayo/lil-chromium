import AppKit

/// A running application as the activation history sees it: enough to
/// reactivate it later (exact process first, same bundle as fallback).
struct ActivatedApp: Equatable {
    let pid: pid_t
    let bundleId: String?

    init(pid: pid_t, bundleId: String?) {
        self.pid = pid
        self.bundleId = bundleId
    }

    init(_ app: NSRunningApplication) {
        self.init(pid: app.processIdentifier, bundleId: app.bundleIdentifier)
    }
}

/// Which app a lil returns to when its prior context is an external app with
/// no recorded process (ADR-0004, issue #31): the last regular app the user
/// activated other than the browser hosting this relay. The extension cannot
/// know it — Chromium only reports that no browser window is focused — so the
/// host watches app activations on the browser's behalf for as long as it lives.
@MainActor
final class ActivationHistory {
    private let browserBundleIds: Set<String>
    private(set) var lastExternal: ActivatedApp?

    init(browserBundleIds: Set<String>) {
        self.browserBundleIds = browserBundleIds
    }

    /// Record an activation. The browser's own activations are the user coming
    /// back to it; the app they left stays on record.
    func note(_ app: ActivatedApp) {
        if let bundleId = app.bundleId, browserBundleIds.contains(bundleId) { return }
        lastExternal = app
    }

    /// A history seeded with the current frontmost app and kept current from
    /// NSWorkspace's activation notifications. Only regular apps count: menu-bar
    /// agents and other accessory apps (LilChromiumApp's palette among them)
    /// activate briefly over the regular app the user is actually in.
    static func observing(browserBundleIds: Set<String>) -> ActivationHistory {
        let history = ActivationHistory(browserBundleIds: browserBundleIds)
        if let app = NSWorkspace.shared.frontmostApplication { history.noteIfRegular(app) }
        _ = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { notification in
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            else { return }
            MainActor.assumeIsolated { history.noteIfRegular(app) }
        }
        return history
    }

    private func noteIfRegular(_ app: NSRunningApplication) {
        guard app.activationPolicy == .regular else { return }
        note(ActivatedApp(app))
    }
}
