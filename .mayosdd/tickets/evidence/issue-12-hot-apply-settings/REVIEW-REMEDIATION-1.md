# Remediation review 1 — issue #12

Refs resolved. Pre-fix `26a9ecdc64a6fa278c423b561dfa4e50287073e0` → head `3caaf61a6b54d73dd57d7dbeff70d727c2472aef`. Delta non-empty (`git diff 26a9ecd...HEAD`: 6 files, +160/−38). One commit: `3caaf61`.

Ledger frozen. No spec reinterpretation.

## Ledger (fix)

### S1 — **resolved**

PROTOCOL Settings singleton uses domain terms.

```
- so all connected browsers and lils converge
+ so all live relays and lils converge
```

### S2 — **resolved**

`handleGetContext` no longer maps names locally. Shared init routes config fields through `ContextPayload`; host identity stays `browser` + `BrowserTable.name(forSlug:)`.

```
+    public init(id: String, browser: String, config: LilConfig) {
+        self.init(
+            ...
+            primaryBrowserName: ContextPayload.displayName(forSlug: config.primaryBrowser, in: config),
+            ...
+            knownBrowsers: ContextPayload.browsers(from: config)
+        )
```

```
-        let ctx = ContextMessage(id: id, browser: browserSlug, browserName: ..., primaryBrowserName: displayName(...), knownBrowsers: known)
+        let ctx = ContextMessage(id: id, browser: browserSlug, config: cfg)
```

`ConfigUpdateMessage` already used the same helpers. Test `contextAndConfigUpdateShareBrowserNormalization` asserts field equality, clamp `100→48`, and empty-config catalog fallback.

### S3 — **resolved**

Fixed caption width removed; slider exposes pixel value to VoiceOver. Visible `N px` caption and layout otherwise unchanged.

```
+                    .accessibilityValue("\(store.config.hoverBar.revealHeight) px")
                     Text("\(store.config.hoverBar.revealHeight) px")
                         .monospacedDigit()
                         .foregroundStyle(.secondary)
-                        .frame(width: 44, alignment: .trailing)
```

## New defects in the fix delta

None.

SwiftUI Pro (Settings only): `accessibilityValue` is appropriate; no rigid width; no layout redesign.

Swift Testing Pro (MessageTests only): struct suite, `#expect`, isolated fixture decode, no XCTest. Multiple expects cover one shared-normalization behavior.

## Outcome

All three ledger fixes resolved. No regressions. No new defects. No `needs adjudication`.
