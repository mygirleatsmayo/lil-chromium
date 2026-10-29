# Remediation review — Issue #5, fix round 1

Pinned: original `c2b692e`, pre-fix `88b8fce`, fix delta `88b8fce...b209517` (`a7747a3` code, `b209517` evidence). Later merge `97ccf71` is out of scope.

## Checked

1. Ledger verdicts and settled interpretations 1–4 (unfocused restore stays; S4 stays; `type: "popup"` stays in code; `registerWindow` prev-merge out of scope).
2. `git diff 88b8fce...b209517` — three files: comment/identifier edits in `extension/background.js`, one test string, evidence dump.
3. Post-fix source at the ledger locations; grep for leftover `spec.record`, `cascadeOrigin(..., fallback)`, `focus: false`, dual URL guards, `type: "popup"`.
4. `focusWindow` still gated by `if (focus)` in `openLil`; only `restoreWindows` passes `focus: false`. No behavior hunks.

## Ledger (fix rows)

1. **S1** resolved — comments now name the restore exception; `focus: false` unchanged.

```
+// around. Focused lil creates are followed by an explicit focusWindow() because
+// create({focused:true}) is unreliable on macOS (research §Focus); unfocused
+// creates (restoreWindows) skip it.
+// Explicit focus. Used after windows.create when a lil is asked to take focus.
```

Restore hunk is not in the delta (`focus: false` still at `openLil` caller `:674`).

2. **S2** resolved — rename only; `openIncognitoLil`'s `fallback` function left.

```
- *   record       URL to store in the registry.
+ *   recordUrl    URL to store in the registry.
-    spec.record || spec.url || ...
+    spec.recordUrl || spec.url || ...
-async function cascadeOrigin(windowId, fallback) {
+async function cascadeOrigin(windowId, unpositionedCoord) {
```

Call sites `restoreWindows` / `cascadeTabToLil` pass `recordUrl:`. No leftover `spec.record`.

3. **S3** resolved — prose only; API `type === "popup"` stays.

```
-// Cascade an existing tab into its own offset popup lil.
+// Cascade an existing tab into its own offset lil.
-  assert.ok(secret, "incognito open creates an incognito popup");
+  assert.ok(secret, "incognito open creates an incognito lil");
```

Next line still `assert.equal(secret.type, "popup")`.

## New defects (delta only)

None. Evidence file is documentation. Won't-fix S4 and the settled interpretations were not acted on.

## needs adjudication

None.
