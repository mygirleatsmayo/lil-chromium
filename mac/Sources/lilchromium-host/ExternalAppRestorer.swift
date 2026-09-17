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

    /// The process a restore request names: the one recorded on the prior
    /// context, or — when it recorded none because the user came back to the
    /// browser from outside it — the app the activation history saw them leave.
    nonisolated static func target(pid: pid_t?, bundleId: String?, history: ActivatedApp?) -> ActivatedApp? {
        switch (pid, history) {
        case let (pid?, _): return ActivatedApp(pid: pid, bundleId: bundleId)
        case let (nil, history?): return history
        case (nil, nil): return nil
        }
    }

    @discardableResult
    static func restore(_ priorContext: PriorContext, history: ActivatedApp?) -> Outcome {
        guard case let .externalApp(recordedPid, recordedBundleId) = priorContext else {
            hlog("host: restore-focus ignored non-external prior context")
            return .notExternal
        }
        guard let target = target(pid: recordedPid, bundleId: recordedBundleId, history: history) else {
            return .noActivationHistory
        }
        let exact = NSRunningApplication(processIdentifier: target.pid)
        let sameBundle = target.bundleId.map(NSRunningApplication.runningApplications(withBundleIdentifier:)) ?? []
        let eligible = ([exact].compactMap { $0 } + sameBundle.filter { $0.processIdentifier != target.pid })
            .filter { isEligible($0, bundleId: target.bundleId) }
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
