# Standards review — issue #5 (`main...v0.4/issue-5-lil-lifecycle`)

Axis only: documented repo standards + Fowler baseline (always judgement). Not a spec review.

## Checked

- Sources: `AGENTS.md`, `docs/PROTOCOL.md`, `CONTEXT.md`, `docs/adr/0001`–`0003`.
- Diff: `28ce689`, `48186e6`, `88b8fce` — `extension/background.js`, tests, `IMPLEMENTATION.md`.
- No Swift. No PROTOCOL / `mac/` / message / `config.json` / socket / slug / pinned-ID edits (three-component rule never engaged).
- `@MainActor` N/A. No `verified:` comments in the hunks.
- Tests drive the production service worker through public entry paths (`AGENTS.md`); repo-root `fixtures/` reused.
- ADR 0001 / 0002 untouched. ADR 0003 named out of scope in `IMPLEMENTATION.md`, not silently overridden.
- Lucas’s human-facing copy untouched.
- Other baseline smells not raised. `spec.size` / `spec.focus` / `spec.registration` / `cascadeOrigin`’s second argument encode real pre-existing path differences.

## Findings

1. **S1 (medium, judgement)** — `extension/background.js` `openLil` `:559` `const focus = spec.focus !== false` and restore `:672` `focus: false`, against untouched comments `:253–254` (“Every lil create is followed by an explicit focusWindow()”) and `:286` (“Always used after windows.create for a lil.”)

   **Standard:** `docs/PROTOCOL.md` Focus discipline (v3): every lil create = `windows.create` then `windows.update({focused:true})`. Restore-unfocused is pre-existing; PROTOCOL’s restore bullet never required focus.

   **Risk:** the shared boundary makes unfocused create a first-class policy that sentence does not list, while nearby comments still claim every create focuses. A later edit can “fix” restore to steal focus. Not hard: this diff preserves the old restore exception.

2. **S2 (low, judgement — Mysterious Name; possible Message Chain)** — `spec.record` (`:586`) is the registry URL, not a registry entry. `cascadeOrigin(windowId, fallback)` (`:595–597`) uses “origin” (URL-ish) and `fallback` (`CONTEXT.md` **Fallback browser**).

   ```
   spec.record || spec.url || (win.tabs && win.tabs[0] && win.tabs[0].url) || ""
   async function cascadeOrigin(windowId, fallback) {
     const offset = (v) => (typeof v === "number" ? v + CASCADE_OFFSET : fallback);
   ```

3. **S3 (low, judgement)** — edited comment `:787` “offset popup lil”; new test `extension/test/worker.test.js:385` “incognito open creates an incognito popup”.

   **Standard:** `CONTEXT.md` **Lil** — Avoid: Popup. PROTOCOL uses `type === "popup"` for the Chromium window type, so `secret.type === "popup"` is fine; the prose names the lil as a popup.

   Wire `sleep*` / `sleep.html` kept: PROTOCOL overrides `CONTEXT.md` **Lil Nap**. Test prose “napping lil” matches the glossary.

4. **S4 (low, judgement — Duplicated Code)** — same URL guard in `openLil` `:552` and `openIncognitoLil` `:609`. Deliberate per `IMPLEMENTATION.md`; still the same shape in two hunks.

No hard documented-standard breach.
