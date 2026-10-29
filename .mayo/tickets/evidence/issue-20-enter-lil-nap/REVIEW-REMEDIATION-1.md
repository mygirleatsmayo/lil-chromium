# Remediation review 1 — issue #20 (enter Lil Nap)

Refs resolved: original `3c36c9a`, reviewed `a6494a2`, frozen/pre-fix `04b51ec`, head `c978ad9` (= `HEAD`). Delta non-empty (`04b51ec...HEAD`: 6 files, +273/−66). Commit: `c978ad9 fix(nap): truthful Lil Nap entry, named nap-page inputs, napping copy`.

SwiftUI (`SettingsWindow.swift` placeholder only; `/swiftui-pro` views/accessibility/design/hygiene): no API, data-flow, or VoiceOver issues; placeholder still names the field’s purpose.

## Ledger (fix)

### S1 — **resolved** (also P2)

Replacement-only release; failure leaves the live document, rolls back nap fields (capture-key guarded), deletes the fresh capture, reports failure. `sleepThisLil` replies `{ ok: slept }`. Protocol matches.

```diff
-  await safe(chrome.tabs.update(tabId, { url }), "tabs.update sleep");
-  return false;
+  if (typeof execute !== "function") return false;
+  return !!injected;
```

```diff
+  if (!released) { /* delete slept, sleepCaptureKey, originalUrl, originalTitle; idbDelete(captureKey); return false */ }
```

```diff
-          sendResponse({ ok: true });
+          sendResponse({ ok: slept });
```

### S2 — **resolved** (also P1)

User-facing nap language; internal IDs/keys unchanged.

```diff
-            TextField("Add domain (never sleep)", text: $newWhitelistDomain)
+            TextField("Add domain (never nap)", text: $newWhitelistDomain)
```

```diff
-      title: "Never sleep this site"
+      title: "Never nap this site"
-    host ? (whitelisted ? "Allow sleeping " + host : "Never sleep " + host) : ...
+    host ? (whitelisted ? "Allow napping " + host : "Never nap " + host) : ...
```

Protocol: `never auto-nap`, `Never nap` / `Allow napping`; `sleep` called out as legacy identifier.

### S3 — **resolved** (also P3 named-input half)

```diff
-function sleepPageUrl(captureKey, originalUrl, tint, originalTitle) {
+function sleepPageUrl({ captureKey, originalUrl, originalTitle, tint }) {
```

Entry and restore pass the same named object. Wire params `k`/`u`/`t`/`tint` unchanged.

### P3 — **resolved**

```diff
+  const tint = ctx.sleep && ctx.sleep.tint ? ctx.sleep.tint : DEFAULT_SLEEP.tint;
-      url: slept ? sleepPageUrl(entry.sleepCaptureKey, entry.originalUrl, undefined, entry.originalTitle) : entry.url,
+      url: slept ? sleepPageUrl({ captureKey, originalUrl, originalTitle, tint }) : entry.url,
```

`DEFAULT_SLEEP.tint` is `"purple"`; used only when config supplies none.

## New defects in the fix delta

None. Rollback is capture-key scoped; no history-pushing sleep path remains; SwiftUI hunk is label-only.

## Outcome

All six ledger rows **resolved**. No regressions. No `needs adjudication`.
