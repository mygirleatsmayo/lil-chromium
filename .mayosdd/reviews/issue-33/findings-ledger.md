# Issue #33 findings ledger

Original fixed point: `2caad300ac966ffc61ac5faa925451ec8b187782`
Initial reviewed point: `2f737e3`

- S1 · `extension/background.js` / `extension/test/chrome.js` live Helium placement claim · **fix**: apply the repository-required `verified:` marker to the confirmed on-box behavior without overstating what the red artifact directly observed.
- P1 · relocated preload cleanup in `wakeLil` · **fix**: a failed cleanup of the misplaced preload must not be swallowed followed by an apparently successful in-place wake; add a focused failure test and keep the lil/Nap state recoverable and truthful. The settled interpretation is that success requires the final original URL to belong only to the lil and no new tab to remain in another window.
- P2 · no green real-Helium artifact · **verification obligation, not a code-remediation finding**: keep #33 open. After reviewed code is loaded, rerun the live command green and retain the sanitized artifact before closure.
- P3 · stored red trace inferred request/return ids and did not observe registry · **verification obligation, not a code-remediation finding**: the green HITL run must use the service-worker probe so all identities and registry state are directly captured before closure.

## Manager review note

The required first `surfx output --diff` was truncated by raw snapshot content. A second, restricted inspection was necessary to finish acceptance review. Before commit, unrelated browsing rows were removed, the durable trace was sanitized, and the trace command was changed not to embed raw before/after snapshots.
