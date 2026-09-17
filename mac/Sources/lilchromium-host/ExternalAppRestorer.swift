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
        case noActivationHistory = "no-activation-history"
        case launchServicesRequested = "launch-services-requested"
    }

    /// A prior context that names a process is restored as recorded; one that
    /// does not (the user came back to the browser from outside it) is the
    /// app the activation history saw them leave.
    @discardableResult
    static func restore(_ priorContext: PriorContext, history: ActivatedApp?) -> Outcome {
        guard case let .externalApp(recordedPid, recordedBundleId) = priorContext else {
            hlog("host: restore-focus ignored non-external prior context")
            return .notExternal
        }
        let target: ActivatedApp
        switch (recordedPid, history) {
        case let (pid?, _): target = ActivatedApp(pid: pid, bundleId: recordedBundleId)
        case let (nil, history?): target = history
        case (nil, nil): return .noActivationHistory
        }
        let (pid, bundleId) = (target.pid, target.bundleId)

        let exact = NSRunningApplication(processIdentifier: pid)
        let sameBundle = bundleId.map(NSRunningApplication.runningApplications(withBundleIdentifier:)) ?? []
        let eligible = ([exact].compactMap { $0 } + sameBundle.filter { $0.processIdentifier != pid })
            .filter { isEligible($0, bundleId: bundleId) }
        guard let first = eligible.first else { return .noEligibleProcess }

        for app in eligible where app.activate(options: [.activateIgnoringOtherApps]) {
            return app === exact ? .activatedExactPid : .activatedByBundleId
        }
        // Direct activation from a faceless host is a request macOS may refuse
        // (research r01 §Q3); opening the bundle through NSWorkspace is the
        // documented cooperative-activation path, the one `open -a` takes.
        guard let bundleURL = first.bundleURL else { return .activationRefused }
        NSWorkspace.shared.openApplication(at: bundleURL, configuration: NSWorkspace.OpenConfiguration()) { _, error in
            hlog("[\(FocusTrace.tag)] restore-focus launch-services bundle=\(bundleURL.lastPathComponent)"
                 + " \(error.map { "error=\($0.localizedDescription)" } ?? "requested")")
        }
        return .launchServicesRequested
    }

    private static func isEligible(_ app: NSRunningApplication, bundleId: String?) -> Bool {
        guard app.isTerminated == false, app.activationPolicy != .prohibited else { return false }
        return bundleId == nil || app.bundleIdentifier == bundleId
    }
}
