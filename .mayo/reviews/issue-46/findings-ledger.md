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

- C2 · The whitelist check moved into `sleepLil` with the local guard, so it also checks the page actually napped (raised by the implementer) · **accepted**: it follows from S2's single parse and fixes the same race for the whitelist.
- C3 · A lil whose URL cannot be parsed is now skipped by the automatic sweep; before, it was napped (raised by the implementer) · **accepted** · Settled: when the guards cannot read the page, the sweep keeps the lil awake.

## Remediation 1

- S2 residual · `hostWhitelisted(parsed.hostname, sleep.whitelist)` drops the earlier `.toLowerCase()`; non-special schemes keep the hostname's case · **fix** (S2 not yet met): both guards keep their previous hostname normalization.
- N1 · A guard abort after the nap is staged leaves the registry entry marked asleep with the old URL; the lil's next navigation is not recorded, and a browser restart reopens the old page · **fix** · Settled: an aborted nap leaves the lil's registry entry as it was before the nap was staged, so later navigation records normally and a restart reopens the page the lil actually shows. Clarified after the fix (implementer's question): "as it was before" covers the nap state; the navigation that caused the abort is recorded like any navigation. Superseded by Remediation 2 below.

## Remediation 2

- N1 (still unresolved) and N2 (new) · The rollback now writes `pending.url` from a `tabs.get` snapshot. Racing the navigation handler, it can be overwritten by the old URL (N1), or itself overwrite a newer navigation the handler already saved (N2: registry keeps `/` while the lil shows `/next`). The test holds a live reference to the entry (`const before = env.registry()[…]`), so it can miss changes · **fix** · Settled: root cause first. While a nap is staged, the navigation handler reads any user navigation as a finished wake (`clearNapState` resets `url` to `originalUrl`); that misreading is the defect, and patching the rollback around it races. Requirements: (1) a user navigation while a nap is staged is recorded by the same path, with the same fields, as an awake lil's navigation; (2) the rollback only removes the nap fields and the capture, and never writes navigation fields from a snapshot; (3) the tests compare against deep copies and cover both orders (navigation before and after the rollback). Restart reopens the page the lil shows in every order.

## Review status

- Full review 1: 4 Standards (S1, S2, S4 fix; S3 won't-fix), 4 Spec (P1, P3 fix; P2, P4 won't-fix), 1 caller item (fix).
- Remediation 1 (`ffa8ec5...111c2b7`): S1, S4, P1, P3, C1 resolved; S2 unresolved (fix); 1 new defect (N1, fix). C2, C3 accepted.
- Remediation 2 (`111c2b7...d11c5c3`): S2 residual resolved; N1 unresolved and N2 new, merged into one root-cause fix.
