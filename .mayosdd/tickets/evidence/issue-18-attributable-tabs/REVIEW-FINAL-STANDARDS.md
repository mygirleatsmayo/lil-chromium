# Final Standards review — issue #18

Fixed point `3c36c9a97d94e5ac9211b81c94e3ec72e226a558` … HEAD `f696b898bd694fb325b2005472373de84ad4c421` (resolves; diff non-empty). Production/test/protocol: `docs/PROTOCOL.md`, `extension/background.js`, `extension/test/chrome.js`, `extension/test/worker.test.js`. Sources: `AGENTS.md`, `CONTEXT.md`, `docs/PROTOCOL.md`. Evidence Markdown is audit context only. Settled ledger interpretations are final.

## Hard documented-standard breaches

None.

Ledger **S1** (link-owned / OAuth must not convert): claim is synchronous at `onCreatedNavigationTarget` entry; conversion returns on `linkOwnedTabIds.has(tab.id)` and `matchesOAuthGuard` after settle. **S2** (contract text): attributable conversion bullet is in `PROTOCOL.md`; extension-only / no wire change matches the settled reading (no app/host edit owed). **P2** is covered through S1 (opener-less and OAuth races). No `CONTEXT.md` language breaches. No Swift / `@MainActor` / `verified:` drift. No message, socket, slug, or pinned-ID edits.

## Baseline smells (judgement)

None new.

Ledger **S3** (`lastNormalWindowId`): **won't-fix** — destination-attribution, not restore MRU; stale id stays safe non-conversion. Distinction is documented in PROTOCOL and the conversion snapshot (`destWindowId`). Not renamed; not re-failed.

Ledger **P1** (`windowId === -1`): **won't-fix; unsupported premise**. Not reopened.

Checked and not raised: dual opener/OAuth gates (event then settle, not copy-paste modules); `linkOwnedTabIds` SW-lifetime Set (session tab ids, as remediations stated); harness `tabs.onCreated` wiring; reuse of `settleTabAndWindow` / `cascadeTabToLil`.

## Outcome

S1, S2, P2 remain resolved. S3, P1 remain won't-fix. No new findings. No adjudication.
