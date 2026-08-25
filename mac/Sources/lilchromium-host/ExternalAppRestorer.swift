import AppKit
import LilShared

/// Native focus restoration for external-app prior contexts. This uses only
/// public activation APIs and makes no sibling-window or Accessibility claim.
@MainActor
enum ExternalAppRestorer {
    /// What the restoration attempt actually did. Returned (rather than only
    /// logged) so the LILFOCUS trace can tell "the wrong app was recorded" from
    /// "the right app was recorded but activation had no visible effect" —
    /// the two live hypotheses in issue #30.
    enum Outcome: String {
        case notExternal = "not-external"
        case activatedExactPid = "activated-exact-pid"
        case activatedByBundleId = "activated-by-bundle-id"
        case noEligibleProcess = "no-eligible-process"
        case activationRefused = "activation-refused"
    }

    @discardableResult
    static func restore(_ priorContext: PriorContext) -> Outcome {
        guard case let .externalApp(pid, bundleId) = priorContext else {
            hlog("host: restore-focus ignored non-external prior context")
            return .notExternal
        }

        let exact = NSRunningApplication(processIdentifier: pid)
        if let exact, isEligible(exact, bundleId: bundleId),
           exact.activate(options: [.activateIgnoringOtherApps]) {
            return .activatedExactPid
        }

        guard let bundleId, !bundleId.isEmpty else {
            return exact == nil ? .noEligibleProcess : .activationRefused
        }
        let siblings = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
            .filter { isEligible($0, bundleId: bundleId) }
        for app in siblings {
            if app.activate(options: [.activateIgnoringOtherApps]) { return .activatedByBundleId }
        }
        return siblings.isEmpty && exact == nil ? .noEligibleProcess : .activationRefused
    }

    private static func isEligible(_ app: NSRunningApplication, bundleId: String?) -> Bool {
        guard app.isTerminated == false, app.activationPolicy != .prohibited else { return false }
        return bundleId == nil || app.bundleIdentifier == bundleId
    }
}
