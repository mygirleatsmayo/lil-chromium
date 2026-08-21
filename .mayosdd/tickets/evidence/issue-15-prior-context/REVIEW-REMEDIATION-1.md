# Remediation review 1 — issue #15

Pinned: original `ea58b515`, pre-fix `4517c5a`, HEAD `54d81f9`. Fix delta `git diff 4517c5a...HEAD` (one commit: `54d81f9`). Production hunks: `extension/background.js`, `extension/test/worker.test.js`. Evidence-only: `REMEDIATION-1.md`. S1/P2 untouched, as settled.

## S2 — resolved

App-supplied capture-gated candidate renamed `appSuppliedPriorContext`. Wire field and stored domain value stay `priorContext`. Gating unchanged (`external-app` only when Chromium has no focused window).

```
-        await openLil({ url: msg.url, left: msg.left, top: msg.top, externalContext: msg.priorContext });
+        await openLil({ url: msg.url, left: msg.left, top: msg.top, appSuppliedPriorContext: msg.priorContext });
```

Same rename on `capturePriorContext`, `openIncognitoLil`, and the `openLil` JSDoc/read. No production leftover `externalContext`.

## P1 — resolved

Promotion marks the source window for the attempt; `onRemoved` skips predecessor unwind while marked; `finally` clears the mark; `deregisterWindow` still runs only when `ok`. Handoff still deregisters before `windows.remove`.

```
+const promotingWindowIds = new Set();
…
-  if (wasLil && wasFocused) {
+  if (wasLil && wasFocused && !promotingWindowIds.has(windowId)) {
     await restorePriorContext(entry ? entry.priorContext : incognitoPriorContext);
   }
```

```
+  if (sourceWindowId !== undefined) promotingWindowIds.add(sourceWindowId);
…
+  } finally {
+    if (sourceWindowId !== undefined) promotingWindowIds.delete(sourceWindowId);
+  }
```

Host-tab MV3 test now blurs, opens `message-open-prior-context`, promotes, and asserts no `restore-focus`. Mark is set before `tabs.move`/`tabs.group`, which is required because the harness closes the empty lil and awaits `onRemoved` during the move — before `ok` is assigned.

## New defects (delta only)

None.

## needs adjudication

None.

## Commands

- `git rev-parse` of `ea58b515`, `4517c5a`, `54d81f9` — all resolve; HEAD is `54d81f9`.
- `git log 4517c5a..HEAD --oneline` — `54d81f9 fix(issue-15): preserve prior context across promotion`.
- `git diff 4517c5a...HEAD --stat` — 3 files, non-empty.
- `pnpm test` — 38/38 pass, including the promotion assertion.

## Verdict

pass
