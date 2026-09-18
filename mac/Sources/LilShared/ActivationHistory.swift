import AppKit

/// A running application as the activation history sees it: enough to
/// reactivate it later (exact process first, same bundle as fallback).
public struct ActivatedApp: Equatable {
    public let pid: pid_t
    public let bundleId: String?

    public init(pid: pid_t, bundleId: String?) {
        self.pid = pid
        self.bundleId = bundleId
    }

    public init(_ app: NSRunningApplication) {
        self.init(pid: app.processIdentifier, bundleId: app.bundleIdentifier)
    }
}

/// The regular app the user was in, among those still running (ADR-0004,
/// issue #31). Two users: the app records it on every `open` as a lil's first
/// prior context, because by the time a link arrives the frontmost app can be
/// Lil Chromium itself; the host answers `restore-focus` with it, excluding the
/// browser it relays for, because Chromium only reports that no browser window
/// is focused.
@MainActor
public final class ActivationHistory {
    private let excludedBundleIds: Set<String>
    /// Regular apps in activation order, most recent last, each once.
    private var external: [ActivatedApp] = []

    public var lastExternal: ActivatedApp? { external.last }

    public init(excluding excludedBundleIds: Set<String> = []) {
        self.excludedBundleIds = excludedBundleIds
    }

    /// Record an activation. Only regular apps (Dock, app switcher) are places
    /// the user returns to: accessory apps such as menu-bar agents — Lil
    /// Chromium itself among them — are passed over, as are the excluded
    /// bundles (a host's browser, whose activations are the user coming back
    /// to it). Neither displaces the app they left.
    public func note(_ app: ActivatedApp, policy: NSApplication.ActivationPolicy) {
        guard policy == .regular else { return }
        if let bundleId = app.bundleId, excludedBundleIds.contains(bundleId) { return }
        forget(pid: app.pid)
        external.append(app)
    }

    /// Drop an app from the history: one that quit is nowhere the user can
    /// return to (the one they were in before it takes its place), and one
    /// being re-noted moves to the most recent slot.
    public func forget(pid: pid_t) {
        external.removeAll { $0.pid == pid }
    }

    /// A live history: seeded with the current frontmost app and kept current
    /// from NSWorkspace's activation and termination notifications for the
    /// life of the process.
    public static func observing(excluding excludedBundleIds: Set<String> = []) -> ActivationHistory {
        let history = ActivationHistory(excluding: excludedBundleIds)
        if let app = NSWorkspace.shared.frontmostApplication { history.note(app) }
        _ = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { notification in
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            else { return }
            MainActor.assumeIsolated { history.note(app) }
        }
        // verified: macOS 27, 2026-09-17 — the terminated NSRunningApplication in
        // the notification still reports its real pid (isTerminated true), not -1.
        _ = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main
        ) { notification in
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            else { return }
            MainActor.assumeIsolated { history.forget(pid: app.processIdentifier) }
        }
        return history
    }

    private func note(_ app: NSRunningApplication) {
        note(ActivatedApp(app), policy: app.activationPolicy)
    }
}
