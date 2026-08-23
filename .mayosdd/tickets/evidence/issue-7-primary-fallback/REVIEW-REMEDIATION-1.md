# Remediation review 1 — issue #7

Checked: frozen ledger at the review-target path (verbatim); HEAD `ac5daa114df767274698e06bc8509521f80c1ce1`; `git log` / `git diff` `ddb62474...ac5daa11`. Code hunks only: `extension/overlay.js`, `mac/Sources/LilChromiumApp/SettingsWindow.swift`. Evidence files in the delta treated as docs. `/swiftui-pro` (accessibility, views, api, design, hygiene, swift) and `/swift-testing-pro` (core-rules, writing-better-tests) applied to the fix delta only. No test files in the delta. Unchanged `promoteTab` read only to confirm S1 routing. Did not re-run tests, install, or launch.

## Ledger (fix rows)

1. **S1 — resolved.** Hoverbar click and ⌘O now call `promote("primary")`, matching the caret item. No remaining `promote("default")` in `overlay.js`. `promote()` still sends `{ action: "promote", dest }`. `promoteTab` still treats any dest other than `group` / `host-tab` / `browser` as Primary, so `"primary"` and the old `"default"` take the same branch.

```
-    promoteBtn.addEventListener("click", () => promote("default"));
+    promoteBtn.addEventListener("click", () => promote("primary"));
-          promote("default");
+          promote("primary");
```

2. **S2 — resolved.** Fallback warning keeps yellow triangle + `.help`; adds `.accessibilityLabel` with the same string. Primary warning hunk has no accessibilityLabel (out of scope). `/swiftui-pro` accessibility: informative `Image` now has a VoiceOver label.

```
                             .help("Choose an installed browser other than Primary.")
+                            .accessibilityLabel("Choose an installed browser other than Primary.")
```

## New defects (delta only)

None. `/swiftui-pro`: no deprecated API, no view/data/navigation/performance issues in the one-line Settings hunk. `/swift-testing-pro`: no Swift Testing in the delta; Swift Testing does not cover VoiceOver; not a defect.

## needs adjudication

None.

No ledger fix regressed.
