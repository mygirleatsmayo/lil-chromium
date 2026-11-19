# Issue #46 findings ledger

Original fixed point: `bf45a2f`
Initial reviewed point: `07ffe5a`

## Standards

- S1 · `runSweep` checks `isLocalPage(url)`, then `sleepLil` re-queries the active tab; a navigation in between naps a local page (PROTOCOL.md Lil Nap guards) · **fix**: same defect as P3; one fix.
- S2 · `isLocalPage` parses the URL right before `hostOf` parses it again (possible Duplicated Code) · **fix**: parse once for both guards, keeping their hostname normalization.
- S3 · Explicit `Binding(get:set:)` for `localGuard` repeats the adjacent guard bindings (possible Duplicated Code) · **won't-fix**: it follows the existing pattern of the neighbouring guards; converting all of them is outside #46.
- S4 · Test helper `napIdleLil` runs a sweep whose callers often expect no nap (possible Mysterious Name) · **fix**: rename (e.g. `sweepIdleLil`).

## Spec

- P1 · "Every writer preserves it and all unknown fields": the app's Settings save replaces the whole `sleep` object and drops unknown nested keys · **fix** · Settled: every app write to `sleep` preserves unknown nested keys, as the host's whitelist writer does.
- P2 · File naps need `captureVisibleTab`, which file tabs block without "Allow access to file URLs" · **won't-fix** · Settled: a file lil can only exist when the extension has file access (Chromium refuses to open a file URL as a lil otherwise; see #47 P1), so capture is available.
- P3 · "the automatic Lil Nap sweep skips every lil showing a local page": navigation between the sweep's read and the nap bypasses the guard · **fix** · Settled: the guard applies to the page actually napped; a navigation between sweep and nap must not bypass it.
- P4 · `localhost.` and `app.localhost.` also count as local · **won't-fix** · Settled: a trailing-dot name is the fully qualified form of the same host.

## Caller

- C1 · "The guard is independent: it works with the audio guard, form guard, and whitelist each on or off": sweep tests run the local guard only with the other guards off (raised by the implementer) · **fix**: cover the local guard skipping with each other guard on.

## Review status

- Full review 1: 4 Standards (S1, S2, S4 fix; S3 won't-fix), 4 Spec (P1, P3 fix; P2, P4 won't-fix), 1 caller item (fix).
