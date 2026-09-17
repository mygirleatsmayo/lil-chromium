import AppKit
import LilShared

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

    /// Record an activation. Only regular apps (Dock, app switcher) are places
    /// the user returns to: accessory apps such as menu-bar agents — this
    /// relay's own LilChromiumApp among them — are passed over, and the
    /// browser's own activations are the user coming back to it. Neither
    /// displaces the app they left.
    func note(_ app: ActivatedApp, policy: NSApplication.ActivationPolicy) {
        guard policy == .regular else { return }
        if let bundleId = app.bundleId, browserBundleIds.contains(bundleId) { return }
        lastExternal = app
    }

    /// A history for the browser that launched this host — known by its slug's
    /// bundle and, in case the slug is unknown, by the launching process —
    /// seeded with the current frontmost app and kept current from
    /// NSWorkspace's activation notifications.
    static func observing(forBrowser slug: String) -> ActivationHistory {
        let browserBundleIds = Set(
            [BrowserTable.bundleId(forSlug: slug), NSRunningApplication(processIdentifier: getppid())?.bundleIdentifier]
                .compactMap { $0 }
        )
        let history = ActivationHistory(browserBundleIds: browserBundleIds)
        if let app = NSWorkspace.shared.frontmostApplication { history.note(app) }
        _ = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { notification in
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            else { return }
            MainActor.assumeIsolated { history.note(app) }
        }
        return history
    }

    private func note(_ app: NSRunningApplication) {
        note(ActivatedApp(app), policy: app.activationPolicy)
    }
}
