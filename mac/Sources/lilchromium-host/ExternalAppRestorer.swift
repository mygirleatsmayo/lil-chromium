import AppKit
import LilShared

/// Native focus restoration for external-app prior contexts. This uses only
/// public activation APIs and makes no sibling-window or Accessibility claim.
@MainActor
enum ExternalAppRestorer {
    static func restore(_ priorContext: PriorContext) {
        guard case let .externalApp(pid, bundleId) = priorContext else {
            hlog("host: restore-focus ignored non-external prior context")
            return
        }

        if let exact = NSRunningApplication(processIdentifier: pid),
           isEligible(exact, bundleId: bundleId),
           exact.activate(options: [.activateIgnoringOtherApps]) {
            return
        }

        guard let bundleId, !bundleId.isEmpty else { return }
        for app in NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
            where isEligible(app, bundleId: bundleId) {
            if app.activate(options: [.activateIgnoringOtherApps]) { return }
        }
    }

    private static func isEligible(_ app: NSRunningApplication, bundleId: String?) -> Bool {
        guard app.isTerminated == false, app.activationPolicy != .prohibited else { return false }
        return bundleId == nil || app.bundleIdentifier == bundleId
    }
}
