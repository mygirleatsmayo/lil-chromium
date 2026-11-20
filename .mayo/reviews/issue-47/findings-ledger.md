# Issue #47 findings ledger

Original fixed point: `bf45a2f`
Initial reviewed point: `438f7db`

## Standards

- S1 · New PROTOCOL.md line "the worker never depends on the overlay being present" contradicts the Lil Nap contract (form guard and idle refresh use content-script signals) · **fix**: limit the guarantee to opening the lil; name the signals that are unavailable without the overlay.
- S2 · Harness matcher handles `<all_urls>` and `*.` hosts the manifest never uses (possible Speculative Generality) · **fix**: match only the pattern forms the manifest uses; keep `overlayInjects` private.
- S3 · Harness re-reads the manifest with `JSON.parse(fs.readFileSync(...))` beside the existing `runtime.getManifest()` · **fix**: share one manifest read.
- S4 · File display repeats the web renderer's span building and styles the file name with class `host` · **fix**: share span creation; name the classes for their visual roles.

## Spec

- P1 · "If the browser denies the extension access to file URLs … the lil still opens and works" · **needs adjudication (Lucas)**: Chromium rejects `windows.create` with a file URL when file access is off, so no lil can open. **won't-fix** · Settled (Lucas): with file access off, Chromium refuses the file URL (`Cannot navigate to a file URL without local file access.`, r04 §5); no lil opens, the worker logs the error, and there is no error loop. The ticket's criterion is amended to say so. Telling the user is a separate ticket under #29.
- P2 · "promote to Primary (⌘O), and the caret menu" on a file lil · **fix** · Settled: promote and the caret menu's other-browser actions must never close a file lil without opening its page. Cross-browser opens carry the file URL to the target browser; the relay accepts `file:` in addition to `http`/`https` and nothing else. Contract change: PROTOCOL.md, host and extension in step. Amended after remediation 1: this means a file lil takes the same `open-external` path as a web lil and closes on the same terms. The existing contract (close once `open-external` is posted to the host; fire-and-forget after that) stands for every lil. Confirming the target browser actually opened the page is a cross-cutting change outside #47 (follow-up candidate). Remediation 1's residual P2 report is resolved on this basis.
- P3 · "Checked live: reload the unpacked extension, open a local `.html` file as a lil" · **verification obligation, not code**: Lucas runs it after the fix round.

## Remediation 1

- S2 residual · The harness regex `^([a-z]+):\/\/(\*?)\/\*$` still accepts forms the manifest doesn't use (`ftp://*/*`) · **fix** (S2 not yet met): accept exactly the forms the manifest uses (`http://*/*`, `https://*/*`, `file:///*`); anything else throws.
- N1 · `cs.matches.some(...)` stops at the first match, so an unsupported pattern after it never throws · **fix**: every pattern in the entry is checked, so an unsupported one throws regardless of order.

## Final review 1

### Standards

- N1 residual · With file access off, `overlayInjects` returns `false` before checking the patterns, so an unsupported pattern after `file:///*` passes silently · **fix** (N1 not yet met): check every pattern before the file-access test.
- S5 · The dirty-form test waits 600 ms on a real timer beside the harness's existing `clock: true` / `clock.advance()` (global rules, YAGNI: reuse what exists) · **fix**: drive the debounce with the harness clock.
- S6 · Comment "so its page is never lost" overstates the hand-off guard; under P2's settled terms the launch can still fail after posting · **fix**: say the lil stays open when posting fails.
- S7 · `isLaunchable` checks scheme prefixes (possible Mysterious Name) · **won't-fix**: the name states the rule (the host launches only these URLs) and its doc comment names the schemes; a mechanism name like `hasAllowedURLPrefix` would say less.

### Spec

- P4 · "A lil showing a `file://` page has the full hoverbar": the worker registers a new lil only after refocusing it; a page that asks `isEphemeral` before registration gets `false`, and the overlay stops for good. Local files load fast enough to hit this. The ordering predates #47 · **fix** · Settled: a lil's page always gets the hoverbar, however fast it loads; the worker must answer `isEphemeral` truthfully for a lil it is still creating. Fix the root cause in the worker's lil creation, not with an overlay retry.
- P1 · settled by Lucas (see Spec P1).
- P3 · still Lucas's live check.

## Remediation 3

- N2 · `await Promise.allSettled(lilCreations)` makes every `isEphemeral` answer wait on every in-flight creation; a registered lil cannot mount its hoverbar until an unrelated lil finishes opening · **fix** · Settled (P4): the answer waits only while the sender's window could still be a lil being created: its own creation, or a creation whose window is not yet known. A registered lil, and any window no pending creation can be, answers at once.

## Remediation 4

- N2 (still unresolved) · `.map((c) => c.done)` then `await Promise.allSettled(pending)` fixes the wait list at request time; a normal window keeps waiting after the unrelated creation learns its window id, and an early request from a lil keeps waiting after its own lil registers · **fix** (N2 not yet met): the Remediation 3 rule holds for the whole wait, not only when the request arrives. The answer comes as soon as the sender's lil is registered or no pending creation can still be the sender's.

- C1 · `Promise.withResolvers()` needs Node 22; `package.json` declares `"node": ">=20"`, so the suite breaks on Node 20–21 (raised by the implementer) · **fix**: stay within the declared engine (`new Promise` covers it); changing the engine floor is Lucas's call, outside #47.

## Remediation 5

- N3 · The early-page test awaits `env.deliver(...)` before checking the reply, so the lil finishes opening first; the test still passes with the registration signal removed (`worker.test.js`) · **fix**: hold a step after registration open and check the reply before releasing it, so the test fails without the registration signal.

## Review status

- Full review 1: 4 Standards (all fix), 3 Spec (P2 fix, P1 pending Lucas, P3 live check).
- Remediation 1 (`e85a1d5...2c9a7a9`): S1, S3, S4 resolved; P2 resolved under the amended interpretation; S2 unresolved (fix); 1 new defect (N1, fix).
- Remediation 2 (`2c9a7a9...32e9d79`): S2 residual and N1 resolved, no new defects. P1 pending Lucas; P3 live check.
- Final review 1 (`bf45a2f...c846091`): Standards N1 residual, S5, S6 fix; S7 won't-fix. Spec P4 fix; P1 pending Lucas; P3 live check.
- Remediation 3 (`c846091...796ff02`): N1 residual, S5, S6, P4 resolved; 1 new defect (N2, fix). P1 pending Lucas; P3 live check.
- Remediation 4 (`796ff02...e12cd54`): N2 unresolved (fix); no other new defects. P1 pending Lucas; P3 live check.
- Remediation 5 (`e12cd54...95d223e`): N2, C1 resolved; 1 new test gap (N3, fix). P1 pending Lucas; P3 live check.
- Remediation 6 (`95d223e...b9a2e41`): N3 resolved; earlier items still resolved; no new defects. Ready to integrate. P1 pending Lucas; P3 live check.
- Lucas adjudicated P1 (won't-fix, criterion amended). Ready to integrate; P3 live check.
- C1 superseded (Lucas): Node 20 is end of life; the floor is now `>=22` and `Promise.withResolvers` is restored (`f15af41`, AGENTS.md).
- Lucas dropped the P2 follow-up candidate (no ticket): confirming the target browser opened the page before the lil closes.
- Telling the user when file access is off is a separate ticket under #29.
