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

## Remediation 3

- N1 (still unresolved) · A registry writer outside the queue (the bounds handler) reads before the rollback and writes after it, restoring `slept` once the capture is deleted; restart then reopens the nap page with no capture · **fix** · Settled: root cause is the registry's unserialized read-modify-writes; queueing three writers leaves the rest racing. Every registry read-modify-write in the worker goes through one serialized update. This absorbs the implementer's follow-up (other writers overwrite each other).
- N3 (new) · `serializeRegistry(() => recordNavigation(changeInfo, tab))` holds the queue through `clearNapState`'s capture deletion; a stalled deletion in one lil keeps another lil's navigation from being recorded · **fix** · Settled: the queue covers only the registry's read, change and write. Other I/O (captures, tab queries) runs outside it, and each change decides from the registry it reads inside the queue, not from an earlier read.
- Tests for both: a bounds change racing the rollback leaves no nap state; a stalled capture deletion in one lil does not delay another lil's navigation record.

## Remediation 4

- N4 (new) · While a nap-document check (`napDocumentMayRemain`) is pending outside the queue, a second navigation of the same lil also sees `slept` and is skipped; the cleanup then writes `originalUrl`, so the registry and a restart reopen `/` while the lil shows `/next` (`518922d` saved `/next`) · **fix** · Settled (amends N3): a lil's own navigations are handled in arrival order, so its registry url ends as the last URL it reported; a navigation that arrives while that lil's nap check or cleanup is pending is recorded after it, never skipped. The ordering is per lil: N3 still holds, and one lil's pending check or capture deletion never delays another lil's record. Test: stall the first nap-document check, navigate to `/next`; the registry ends at `/next` and a restart reopens it.

## Remediation 5

- N5 (new) · The per-lil queue waits on `clearNapState`'s capture deletion, so a lil's later events are handled late, against later state: with the first nap's deletion stalled, navigate to `/next`, nap and wake again; once the deletion ends, the second nap's queued release is recorded as `url`, and a restart reopens a nap page whose capture is gone (`4b5f231` restored `/next`) · **fix** · Settled: root cause is a late event read against later state, and the registry can then hold a URL the user can never return to. Two requirements: (1) a lil's registry `url` never holds a nap-page URL, however late its event is handled; (2) capture I/O never holds a lil's navigation queue: the per-lil order (N4) covers the nap check and the registry change, and the capture deletion runs after, outside it. Test: the reviewer's sequence ends with `url` at `/next`, and a restart reopens it.

## Remediation 6

- N6 (new) · The N5 regression test dispatches the second nap's navigation event at once (`pending.push(fire.apply(onUpdated, event))`), so it passes with the old guard restored; held until after the wake, that event makes the old guard record the nap URL · **fix**: hold the second nap's event and replay it after the wake, so the test fails without the N5 guard and passes with it.

## Final review 1

Severity bar (Lucas, for #46 only): a fix round runs only for a spec miss, a bug a user could plausibly hit, or a hard breach of a repo rule. Rare races, test gaps and smells do not get a fix round.

### Standards

- S5 · Leaving a nap by a navigation other than the wake records the pre-nap page (`clearNapRegistry` restores `originalUrl`); a restart before the next navigation reopens it · **won't-fix** under the bar: predates #46 (`bf45a2f` already restored `originalUrl` on this path). Follow-up candidate, pending Lucas.
- S6 · The release check in `replaceTabDocument` compares only protocol and hostname, so a path or port change during capture still naps and wakes to the earlier page · **won't-fix** under the bar: predates #46, which narrows it. Same as P7. Follow-up candidate, pending Lucas.
- S7 · Smells: nap-field removal written twice; `hostOf` could reuse `parseUrl`; one-member `fieldMergedKeys` · **won't-fix**: judgment calls; the set's doc comment says why only `sleep` merges field by field.

### Spec

- N1 residual · `sleep.js`'s fallback (`reconcileNapState`) writes the whole registry outside the worker queue and can undo another lil's rollback · **won't-fix** under the bar: predates #46, runs only when the worker fails or does not answer. Follow-up candidate, pending Lucas.
- P5 · A guard switched on mid-sweep misses the rest of that sweep · **won't-fix** · Settled: every guard reads the config the sweep started with, so this guard "hot-applies like the other guards".
- P6 · App saves drop unknown keys nested in `hoverBar` and `searchEngine` · **won't-fix** · Settled: PROTOCOL.md:99 asks for nested-key preservation inside `sleep` only; merging `hoverBar` field by field would bring back a cleared tint.
- P7 · Same as S6.
- P8 · A host change during capture cancels the nap even with every guard off · **accepted** · Settled (follows P3/C2): guards apply to the page actually napped; napping would keep a stale screenshot and wake to the wrong page.

## Review status

- Full review 1: 4 Standards (S1, S2, S4 fix; S3 won't-fix), 4 Spec (P1, P3 fix; P2, P4 won't-fix), 1 caller item (fix).
- Remediation 1 (`ffa8ec5...111c2b7`): S1, S4, P1, P3, C1 resolved; S2 unresolved (fix); 1 new defect (N1, fix). C2, C3 accepted.
- Remediation 2 (`111c2b7...d11c5c3`): S2 residual resolved; N1 unresolved and N2 new, merged into one root-cause fix.
- Remediation 3 (`d11c5c3...518922d`): N2 resolved; earlier items still resolved; N1 unresolved (root cause widened to every registry writer); 1 new defect (N3, fix).
- Remediation 4 (`518922d...4b5f231`): N1, N3 resolved; earlier items still resolved; 1 new defect (N4, fix).
- Remediation 5 (`4b5f231...64e895f`): N4 resolved; earlier items still resolved; 1 new defect (N5, fix).
- Remediation 6 (`64e895f...1ca91d3`): N5 resolved in production; earlier items still resolved; 1 new test gap (N6, fix).
- Remediation 7 (`1ca91d3...647e0dc`): N6 resolved; earlier items still resolved; no new defects.
- Final review 1 (`bf45a2f...0199379`): no finding meets the #46 severity bar; S5, S6/P7, N1 residual are follow-up candidates; P5, P6 settled won't-fix; P8 accepted; S7 won't-fix. Ready to integrate.
