# Issue #47 findings ledger

Original fixed point: `bf45a2f`
Initial reviewed point: `438f7db`

## Standards

- S1 · New PROTOCOL.md line "the worker never depends on the overlay being present" contradicts the Lil Nap contract (form guard and idle refresh use content-script signals) · **fix**: limit the guarantee to opening the lil; name the signals that are unavailable without the overlay.
- S2 · Harness matcher handles `<all_urls>` and `*.` hosts the manifest never uses (possible Speculative Generality) · **fix**: match only the pattern forms the manifest uses; keep `overlayInjects` private.
- S3 · Harness re-reads the manifest with `JSON.parse(fs.readFileSync(...))` beside the existing `runtime.getManifest()` · **fix**: share one manifest read.
- S4 · File display repeats the web renderer's span building and styles the file name with class `host` · **fix**: share span creation; name the classes for their visual roles.

## Spec

- P1 · "If the browser denies the extension access to file URLs … the lil still opens and works" · **needs adjudication (Lucas)**: Chromium rejects `windows.create` with a file URL when file access is off, so no lil can open. Not sent for fixing until decided.
- P2 · "promote to Primary (⌘O), and the caret menu" on a file lil · **fix** · Settled: promote and the caret menu's other-browser actions must never close a file lil without opening its page. Cross-browser opens carry the file URL to the target browser; the relay accepts `file:` in addition to `http`/`https` and nothing else. Contract change: PROTOCOL.md, host and extension in step.
- P3 · "Checked live: reload the unpacked extension, open a local `.html` file as a lil" · **verification obligation, not code**: Lucas runs it after the fix round.

## Review status

- Full review 1: 4 Standards (all fix), 3 Spec (P2 fix, P1 pending Lucas, P3 live check).
