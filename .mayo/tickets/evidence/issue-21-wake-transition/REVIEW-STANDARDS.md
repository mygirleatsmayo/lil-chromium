# Standards — issue #21 (first full review)

Fixed point `3ce95733d807ca39a51eeb36cdcb6e42f7984ce2` → head `1b2673b79a8d7f798732117440591a07f7e48562` (both resolve; diff non-empty: PROTOCOL Lil Nap wake, `wakeLil` / `waitForWakeSwap` / `clearNapState`, sleep-page reply-gated fallback, test fakes/clock).

Sources: `AGENTS.md`, `CONTEXT.md`, `docs/PROTOCOL.md`, smell baseline. Judgements are not hard breaches.

## Hard breaches

None.

Checked: PROTOCOL wake text and extension hunks agree (preload inactive tab, 180 ms floor, 500 ms cap, swap then clear nap fields + capture, replacement-only fallback, `{ok:false}` leaves nap intact). No messages, `config.json`, sockets, slugs, routing, or pinned IDs — app/host correctly untouched. No AppKit / `@MainActor` / `verified:` edits. Internal `sleep*` identifiers kept; no new user-facing “Sleep” / “sleeping lil” copy. Lucas README/CHANGELOG prose untouched.

## Smell judgements

1. **Duplicated Code** — remaining-to-floor wait is computed twice in `extension/background.js` instead of one helper used by both the preload waiter and the create-failure path.

```javascript
const wait = Math.max(0, startedAt + WAKE_MIN_HOLD_MS - Date.now());
if (wait === 0) finish();
else floorTimer = setTimeout(finish, wait);
```

```javascript
const wait = startedAt + WAKE_MIN_HOLD_MS - Date.now();
if (wait > 0) await delay(wait);
```

2. **Speculative Generality** — harness clock API wider than any test in this diff. `createClock` is exported but never imported; `boot({ clockStart })` is never passed (`extension/test/harness.js`).

```javascript
export function createClock(start = 1_700_000_000_000) {
```

```javascript
const clock = options.clock === true ? createClock(options.clockStart) : null;
```

Not filed: seven tests repeating nap-then-wake arrange (readable per-AC, not a production module split). `background.js` remaining a large SW file (pre-existing home for tab behavior).
