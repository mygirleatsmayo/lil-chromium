# issue #30 — the real-Mac focus loop

One command reports the two v0.4 focus regressions red or green against a real
Mac, and writes a machine-readable trace a later worker can re-score without
repeating a gesture.

    node scripts/focus-loop.mjs run

Exit status: `0` every scenario green · `1` at least one reproduced (red) ·
`2` something could not be scored · `3` preflight failed.

The regressions under test (from
`../issue-26-integrated-qa/FOCUS-NAP-REGRESSIONS-2026-08-25.md`):

1. **close** — closing a focused lil restores the wrong Helium sibling instead
   of the application that was in front.
2. **open** — opening a lil raises an unrelated Helium sibling, sometimes on a
   different display. Intermittent, so it is scored by reproduction rate.

---

## How it decides

Neither symptom is visible to Chromium: it reports one focused window and knows
nothing about which application macOS put in front. So the verdict comes from a
native window reading, and the extension only explains it.

| view | source | what it contributes |
|---|---|---|
| native | `lil-focus-probe` (`mac/Sources/LilFocusProbe`) | frontmost application, every on-screen window front-to-back, owner pid/bundle id, bounds, display |
| extension | `extension/focus-trace.js` | window identity/type/focus state, app-supplied vs chosen prior context, focus events, close restoration target |
| host | `[LILFOCUS]` lines in `~/.lilchromium/host-<slug>.log` | the `open` the app sent, the `restore-focus` received, what activation returned, who ended up in front |

The rule, in `scripts/focus-loop/verdict.mjs`:

- A browser window **rose** when it overtook a window of *another* application
  that used to be in front of it.
- **open** is red when *any* of three independent requirements fails. Each is
  named separately in the reason, and each on its own is enough for red:
  1. the requested lil is on the display of the application it was opened from
     (a lil that appears on the Primary window's display instead is the
     cross-display symptom, and it shows even when nothing overtook anything);
  2. the lil was left as the focused front window of the browser;
  3. no *other* browser window came forward with it.
- **close** is red when the frontmost application afterwards is not the one that
  was frontmost before the lil took focus (ADR-0004).
- A repetition that cannot be observed is **inconclusive** — never green. An
  unreadable source display is inconclusive, not green.

The lil is identified by the bounds the extension reported creating, not by
"the newest window", so a sibling Chromium happened to recreate is never
silently exempted.

**No Accessibility permission and no private API.** The probe uses public
`CGWindowListCopyWindowInfo` and never reads window titles (titles are the only
part that is permission-gated). Activating an app and opening a lil go through
`/usr/bin/open`, i.e. the real default-browser path.

---

## The diagnostic control (contract)

The loop drives the extension through a **private diagnostic control**, not a
product message: `{"type":"lil-focus-trace", "op":…}` over the relay socket.
It is specified in `docs/PROTOCOL.md` and implemented in all three components:

| component | file | responsibility |
|---|---|---|
| harness | `scripts/focus-loop/channel.mjs` | sends the four operations, hosts the collector |
| host | `mac/Sources/LilShared/FocusTraceControl.swift`, `mac/Sources/lilchromium-host/FocusTrace.swift` | decodes and validates; a line it cannot vouch for is dropped, never forwarded |
| extension | `extension/focus-trace.js` | executes only while armed |

Four operations, and no others:

    { op: "arm",       runId, port, ttlMs? }   arm this run
    { op: "disarm" }                           disarm
    { op: "snapshot",  label }                 report the window list
    { op: "close-lil", runId, windowId }       close one lil this run opened

Two properties the harness depends on:

- **The collector URL is never sent.** `arm` carries a port and a run id; the
  extension *derives* `http://127.0.0.1:<port>/t/<runId>` from them. There is no
  endpoint field to redirect, and the collector serves only its own run's path,
  so a worker still armed for an earlier run cannot post into this trace.
- **Teardown can only close a lil this armed run opened.** The seam keeps the
  set of window ids it created while armed, re-checks the window is still a
  registered lil, and answers with what actually happened:
  `closed` · `not-owned-by-this-run` · `no-longer-a-registered-lil` ·
  `close-failed`. Primary, another run's lil, an operator-closed lil, and a
  stale id are all refused. The run trusts the answer, never the request.

Outside an armed run the seam does nothing: it is inert until armed, armable
only over the relay socket (never from a page and never from storage, so a
service-worker restart disarms it), every arm carries a TTL of at most 30
minutes, nothing on the traced path is awaited, and every failure is swallowed.

---

## Preflight

Every check runs **before the loop touches a single window**, and any failure
exits `3` having mutated nothing:

1. macOS.
2. `~/.lilchromium/relay-helium.sock` exists.
3. **The running browser carries a live seam.** The run arms (which changes
   nothing on screen) and waits for the extension to answer. No answer means
   the loop could open a lil it has no safe way to close, so it refuses to open
   one:

       preflight: the running browser carries no live LILFOCUS seam, so this run
                  could open a lil it cannot close.
                  Load extension/ from this worktree and reload it, then run again.

A run that gets past preflight prints:

    extension seam: live (collector http://127.0.0.1:8931/t/<runId>)

Teardown is checked the same way, per repetition: an opening repetition that
cannot close its lil stops the scenario (the confirmed arrangement no longer
holds) and the remaining repetitions are recorded inconclusive rather than
scored against a changed screen. However a run ends — verdict, error, or
interrupt — it sweeps every lil it opened and still holds, and prints a loud
warning naming any window id it could not close.

---

## Prerequisites

1. macOS, Helium running, and the lil-chromium extension loaded **from this
   worktree** (`extension/`), so the seam is live. Preflight refuses otherwise.
2. **Close every lil first.** The loop identifies lils by "appeared during this
   run"; a lil already on screen at baseline makes the arrangement unknown and
   every scenario is skipped.
3. `mac/.build/release/lil-focus-probe` — built automatically on first run, or
   ahead of time with `swift build -c release --product lil-focus-probe` in `mac/`.
4. Build this worktree's app and host too if you want the `source: "host"`
   records; the loop decides correctly without them.

The loop takes over the keyboard focus while it runs (that is the measurement).
Do not use the Mac during a run.

---

## Flags

    --scenarios <csv>    id or prefix filter, e.g. "open/" or "close/immediate"
    --reps <n>           override the per-scenario repetition count
    --source-app <id>    bundle id a lil is opened from     (default com.apple.mail)
    --switch-app <id>    bundle id switched to mid-scenario (default md.obsidian)
    --browser <slug>     relay slug                         (default helium)
    --bundle-id <id>     that browser's bundle id           (default net.imput.helium)
    --url <url>          URL each lil opens                 (default https://example.com/)
    --port <n>           local collector port               (default 8931)
    --settle-ms <n>      window-server settle wait          (default 900)
    --gesture-timeout-ms <n>  how long one gesture may take (default 120000)
    --out <dir>          artifact directory

---

## Scenarios

Defined once in `scripts/focus-loop/scenarios.mjs`, so the run, the replay, and
this document cannot drift apart.

**Close** (2 repetitions each; each ends in a gesture macOS gives no
permission-free way to perform, so each needs a person at the Mac):

| id | what it covers |
|---|---|
| `close/immediate` | close a focused lil right after opening it from an external app |
| `close/switch-then-refocus` | switch to another app, click the lil to refocus it, then close it |
| `close/unfocused-red-button` | close a background lil with **only** its red control, never focusing it |

**Open** (3 repetitions each, fully automatic — two arrangements × three
neighbour states):

    open/{same-display,cross-display}/{no-other-lil,lil-on-source-display,lil-on-primary-display}

The harness verifies the arrangement against the real screen before scoring it
(up to three attempts, prompting you to adjust) and refuses to score a scenario
whose arrangement never matched.

### Gestures

The only human input, and the run **watches** for each one instead of asking you
to confirm it:

    >>> Close the focused lil (⌘W, or click its red close control).
        (waiting for it — no keystroke, do not touch this terminal)

This is not a convenience. Pressing Enter in a terminal *is* an application
activation, and it would land between the gesture under test and the reading
that scores it — turning a correct restore into a false red. So a gesture step
names one gesture and nothing else; the seam reports the window going away
(`lil-closed`) or coming forward (`lil-focused`), and the reading follows
automatically. `close/unfocused-red-button` therefore asks for exactly one
click on the red control and nothing afterwards.

The gestures:

- `Close the focused lil (⌘W, or click its red close control).`
- `Click the lil once to refocus it. Do not close it yet.`
- `Now close the focused lil (⌘W, or click its red close control).`
- `WITHOUT focusing the lil first, click ONLY its red close control (one click on
  the button itself). That is the whole gesture.`

A gesture not observed within `--gesture-timeout-ms` makes that repetition
inconclusive, never green. Arrangement setup is the one place Enter is still
asked for (`Adjust the windows to match, then press Enter.`) — no measurement
is in flight there.

Run without a terminal and the close scenarios are skipped and reported
`inconclusive: no operator`, rather than silently passing.

---

## Output

Two files per run in this directory:

- `trace-<runId>.jsonl` — every record, in order.
- `verdict-<runId>.json` — environment, settings, per-scenario verdicts.

Every record carries `tag: "LILFOCUS"` and a `source`.

    source: "probe"      { label, t, frontmost{pid,bundleId,name}, displays[], windows[] }
                         windows[] is front-to-back: { order, number, pid, bundleId,
                         owner, bounds{x,y,w,h}, display }
    source: "extension"  { runId, seq, t, event, detail }
                         events: trace-armed | windows | open-request |
                         prior-context-capture | lil-create-begin | lil-created |
                         focus-changed | window-removed | restore-attempt |
                         harness-close | trace-disarmed
    source: "host"       [LILFOCUS] lines: open url=… appPriorContext=… ·
                         restore-focus target=… outcome=… · frontmost after settling
                         (plus `control …` / `control dropped: …` from the host's
                         own validation of the diagnostic control)
    source: "harness"    seam | arrangement-check | repetition-begin | gesture |
                         repetition-verdict | teardown-sweep

`verdict-<runId>.json`:

    { tag, issue: 30, runId, startedAt, seamLive,
      environment { platform, browserVersion, appVersion, extensionVersion, worktreeCommit },
      settings { browser, bundleId, sourceApp, switchApp, url, settleMs },
      counts { red, green, inconclusive },
      overall: "red" | "green" | "inconclusive",
      scenarios: [ { scenario, kind, verdict, reproductions, repetitions, inconclusive,
                     rate, repetitions: [ { repetition, verdict, reason, … } ] } ] }

An open repetition also carries `lil` (`{number, display, order}`), `sourceApp`,
`sourceDisplay`, `onSourceDisplay`, `lilIsFrontWindow`, `frontmostApp`,
`frontmostIsBrowser`, `risenSiblings[]` (each with `overtook[]` — exactly which
foreign windows it passed), `identifiedBy` (`extension` or `native`),
`createdWindowId`, and `teardown` (the outcome the seam reported). A close
repetition carries `expected`, `actual`, `landedOnBrowser`, and `risenSiblings[]`.

### Re-scoring without a Mac

    node scripts/focus-loop.mjs replay <trace.jsonl>

Replay and the live run score through the same functions (`scoreRepetition` and
`foldRun` in `scripts/focus-loop/verdict.mjs`), so an artifact can never
disagree with the run that produced it. This is how #31 and #32 check a fix
against the recorded symptom, and how a fresh worker consumes this evidence
without replaying the original conversation.

---

## Interpreting a result

| you see | it means |
|---|---|
| `red` on a `close/…` scenario | symptom 1 reproduced; `actual` names where focus landed, `risenSiblings` names the sibling that came forward |
| `red` on an `open/…` scenario | symptom 2 reproduced; the reason names which of the three requirements failed, `rate` is the reproduction rate over the repetitions, `risenSiblings[].overtook` names what each sibling passed |
| `green` everywhere | neither symptom reproduced under the arrangements that were verified |
| `inconclusive` | the loop could not observe the scenario — arrangement never matched, no operator, a gesture that never arrived, a teardown that did not close, or a missing reading. **Not** a pass |
| exit `3` | preflight failed; nothing on screen was touched |

A downstream fix is verified by the *same* command with the same contract: red
before, green after, same scenarios, same exit codes.

---

## Cleanup check

    node scripts/focus-loop.mjs cleanup

Sends a disarm to the relay and prints the one grep that shows the entire seam:

    grep -rn LILFOCUS extension mac scripts docs

The seam is **retained deliberately** as a test seam (#30 allows either), and is
behaviour-neutral outside an armed run by construction (see *The diagnostic
control* above). Removing it entirely means deleting the tagged sites that grep
lists — every one of them carries `LILFOCUS`.

---

## Verification performed

### Focused red/green commands

Each of these was run red first (assertion failing against the previous
behaviour), then green:

```
node --test scripts/focus-loop/verdict.test.mjs
```

```
node --test scripts/focus-loop/replay.test.mjs
```

```
node --test scripts/focus-loop/scenarios.test.mjs
```

```
node --test extension/test/focus-trace.test.js
```

```
cd mac && swift test --filter "FocusProbeTests|MessageTests"
```

### Suites

    pnpm test                       184 pass, 0 fail   (extension suite + harness suite)
    cd mac && swift test            169 pass, 0 fail   (17 suites)

Focused tests behind the loop:

- `scripts/focus-loop/verdict.test.mjs` (15) — states each symptom as a window
  reading and requires red; states the intended behaviour and requires green.
  Includes the three open requirements scored independently, and the fold that
  turns repetitions into a run summary.
- `scripts/focus-loop/replay.test.mjs` (3) — the whole path red end to end from a
  stored trace, deterministic, and still correct with the extension records
  stripped out.
- `scripts/focus-loop/scenarios.test.mjs` (7) — pins the coverage #30 asks for,
  that no gesture is followed by a keystroke, and that the unfocused case asks
  for the red button and nothing else.
- `extension/test/focus-trace.test.js` (16) — the seam: inert until armed, TTL
  expiry, tagged and ordered records, contexts and restoration targets recorded,
  an unreachable collector leaving the traced path working, a collector endpoint
  that cannot be redirected, an untrusted arm leaving it disarmed, and teardown
  that closes only a lil this armed run opened — never Primary, another run's
  window, or a stale id.
- `mac/Tests/LilChromiumTests/MessageTests.swift` (2) and `FocusProbeTests.swift`
  (4), each tagged `.bug(id: 30)` — the control message decodes to the four
  operations, every line the host cannot vouch for is dropped rather than
  forwarded, and the probe's own readings stay pinned to this issue.

### Red-capable proof

    node scripts/focus-loop.mjs replay fixtures/focus-loop/synthetic-v04-symptoms.jsonl

    --- LILFOCUS verdict ---
      red          close/immediate (2/2)
      red          open/cross-display/no-other-lil (2/3)
      green        open/same-display/lil-on-primary-display (0/3)
      overall: red
    exit=1

`fixtures/focus-loop/synthetic-v04-symptoms.jsonl` is **synthetic** — hand-authored
window readings, not a real-Mac run; its first record says so. It exists to prove
the command reports these symptoms red end to end, and that green is still
reachable so the loop is not stuck red. Its `open/cross-display/no-other-lil`
repetitions cover both open faults: two where a sibling rose, and one where the
lil landed on the wrong display while nothing overtook anything.

    node scripts/focus-loop.mjs cleanup     → disarm sent, exit 0
    git diff --check                        → clean

### Real-Mac run

**Recorded against the previous contract (commit `e624c3d`), before this
remediation.** It is kept because the observation is real; the `seamLive: false`
mode it describes no longer exists — preflight now refuses to open a lil it
cannot close.

    node scripts/focus-loop.mjs run
    → trace-2026-08-25T21-40-45-475Z.jsonl / verdict-2026-08-25T21-40-45-475Z.json

Environment: darwin 27.0.0 · Helium 0.15.7.1 · LilChromium v0.2-192-g6cf3671 ·
extension 0.4.0-trial · worktree 2caad30.

Ran unattended against the live v0.4 trial. The whole path worked: it activated
Mail, handed the URL to the default browser, watched a real lil appear
(CG window 45553, 1024×900 on display 0, front-to-back position 0) and read the
Primary window moving from position 3 to 4 — it did not rise, so
`open/cross-display/no-other-lil` scored green on requirement 3 for that
repetition.

`overall: inconclusive`. Nothing reproduced, and nothing was disproved, because:

- `seamLive: false` — the live browser loads the extension from
  `~/projects/lil-chromium-v0.4/extension`, not this worktree, so the seam was
  not present. Without it the loop could not close the lil it opened, which
  capped it at one repetition per arrangement. Symptom 2 is intermittent; one
  repetition cannot settle it.
- The three close scenarios need a person at the Mac and were skipped.
- The remaining open arrangements need Mail and the Primary window on the same
  display, and a lil placed as a neighbour.

**Outstanding**: a full red-capable run with the seam live and an operator
present. No such run has been made against the corrected loop, and no synthetic
stand-in is offered for one. Exact invocation below.

---

## To finish the run

1. Point the loaded unpacked extension at this worktree's `extension/` directory
   and reload it, so the seam is live. Preflight will refuse to run otherwise.
2. Close every open lil.
3. Put Mail and the Helium Primary window on **different** displays to start; the
   loop prompts you to rearrange between scenarios.
4. From this worktree, in a real terminal:

```
node scripts/focus-loop.mjs run
```

5. Make each gesture the `>>>` prompt names, exactly as written — and then leave
   the keyboard alone. The run detects completion itself; there is nothing to
   press afterwards.
6. When it finishes it prints the verdict and the two artifact paths. Re-score
   any time with:

```
node scripts/focus-loop.mjs replay .mayosdd/tickets/evidence/issue-30-real-mac-focus-loop/trace-<runId>.jsonl
```

To do just one symptom:

```
node scripts/focus-loop.mjs run --scenarios close/
```

```
node scripts/focus-loop.mjs run --scenarios open/ --reps 5
```
