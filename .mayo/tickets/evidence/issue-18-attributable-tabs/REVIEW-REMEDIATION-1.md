# Remediation review 1 — issue #18

Frozen ledger: `ledger.md`. Pre-fix `28ccf28e76067157b97d167233eb659f72338ebd`. Head `e4b821970f6eca81810258c1c8d5c8180708edfb`. Delta: `docs/PROTOCOL.md`, `extension/background.js`, `extension/test/worker.test.js`, `REMEDIATION-1.md`. Refs resolve; delta non-empty.

## Ledger (fix items)

### S1 — **resolved**

Claim is public-event identity, not clocks.

```diff
+  if (details && typeof details.tabId === "number") linkOwnedTabIds.add(details.tabId);
```

(at `onCreatedNavigationTarget` entry, before any `await`)

```diff
+    if (linkOwnedTabIds.has(tab.id)) return;
     if (live.openerTabId !== undefined && live.openerTabId !== null) return;
+    if (matchesOAuthGuard(live.url || live.pendingUrl)) return;
```

(after `settleTabAndWindow`, with existing opener/active/window re-checks)

Link-claimed tabs cannot convert; missing-opener stays the conversion gate plus claim; OAuth leave-alone is applied on this path too.

### P2 (through S1) — **resolved**

`linkSpawnFromLil` starts `tabs.create` without awaiting, reads the journal tab id, then fires `onCreatedNavigationTarget` while `onCreated` is in flight. Two tests: opener-less spawn; OAuth spawn. No `windowId === -1`.

### S2 — **resolved**

`docs/PROTOCOL.md` Extension behavior: bullet **Attributable new-tab conversion (v4, issue #18)** — positive tie, navigation-target ownership regardless of listener order, leave-alone (popup / missing opener / OAuth), incomplete-tie non-conversion, extension-only (no wire change).

## Unchanged ledger

S3, P1 remain **won't-fix**. Delta does not rename `lastNormalWindowId` or add `windowId === -1`.

## New defects in the delta

None. Claim-set lifetime (session tab ids, SW-scoped) matches the stated contract; no TTL/proximity attribution introduced.

## Outcome

S1, S2, P2 resolved. No regressions. No adjudication.
