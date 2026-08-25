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
- **open** is red when any browser window other than the requested lil rose.
- **close** is red when the frontmost application afterwards is not the one that
  was frontmost before the lil took focus (ADR-0004).
- A repetition that cannot be observed is **inconclusive** — never green.

The native reading alone is enough to decide. The extension seam sharpens *which*
new window was the lil and *why* the browser chose a predecessor; a run against a
browser without the seam still produces a verdict and records `seamLive: false`.

**No Accessibility permission and no private API.** The probe uses public
`CGWindowListCopyWindowInfo` and never reads window titles (titles are the only
part that is permission-gated). Activating an app and opening a lil go through
`/usr/bin/open`, i.e. the real default-browser path.

---

## Prerequisites

1. macOS, Helium running, the lil-chromium extension loaded, and
   `~/.lilchromium/relay-helium.sock` present. Preflight checks the socket.
2. **Close every lil first.** The loop identifies lils by "appeared during this
   run"; a lil already on screen at baseline makes the arrangement unknown and
   every scenario is skipped.
3. For a *fully* populated trace, the running browser must carry this worktree's
   `extension/focus-trace.js` — i.e. the unpacked extension is loaded from this
   worktree. Without it the loop still runs and still decides, but it collects no
   extension or host records and **cannot close the lil it opened**, so only one
   repetition per arrangement is possible. The run prints which mode it is in:

       extension seam: live
       extension seam: absent (native-only verdicts)

4. `mac/.build/release/lil-focus-probe` — built automatically on first run, or
   ahead of time with `swift build -c release --product lil-focus-probe` in `mac/`.

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
    --out <dir>          artifact directory

---

## Scenarios

Defined once in `scripts/focus-loop/scenarios.mjs`, so the run, the replay, and
this document cannot drift apart.

**Close** (2 repetitions each; each ends in a gesture macOS gives no
permission-free way to perform, so each needs a person at the terminal):

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

### Operator prompts

The only human input. Each is printed as `>>> …  [Enter when done]`:

- `Close the focused lil (⌘W, or click its red close control).`
- `Click the lil once to refocus it. Do not close it yet.`
- `Now close the focused lil (⌘W, or click its red close control).`
- `WITHOUT focusing the lil first, click ONLY its red close control (one click on
  the button itself), then return to what you were doing.`
- `Adjust the windows to match, then press Enter.` (arrangement setup)

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
    source: "harness"    baseline | seam | arrangement-check | repetition-begin |
                         repetition-verdict

`verdict-<runId>.json`:

    { tag, issue: 30, runId, startedAt, seamLive,
      environment { platform, browserVersion, appVersion, extensionVersion, worktreeCommit },
      settings { browser, bundleId, sourceApp, switchApp, url, settleMs },
      counts { red, green, inconclusive },
      overall: "red" | "green" | "inconclusive",
      scenarios: [ { scenario, kind, verdict, reproductions, repetitions, inconclusive,
                     rate, repetitions: [ { repetition, verdict, reason, … } ] } ] }

An open repetition also carries `lil`, `lilIsFrontWindow`, `frontmostApp`,
`frontmostIsBrowser`, `risenSiblings[]` (each with `overtook[]` — exactly which
foreign windows it passed), `identifiedBy` (`extension` or `native`), and
`toreDown`. A close repetition carries `expected`, `actual`, `landedOnBrowser`,
and `risenSiblings[]`.

### Re-scoring without a Mac

    node scripts/focus-loop.mjs replay <trace.jsonl>

Replay and the live run score through the same function
(`scoreRepetition` in `scripts/focus-loop/replay.mjs`), so an artifact can never
disagree with the run that produced it. This is how #31 and #32 check a fix
against the recorded symptom, and how a fresh worker consumes this evidence
without replaying the original conversation.

---

## Interpreting a result

| you see | it means |
|---|---|
| `red` on a `close/…` scenario | symptom 1 reproduced; `actual` names where focus landed, `risenSiblings` names the sibling that came forward |
| `red` on an `open/…` scenario | symptom 2 reproduced; `rate` is the reproduction rate over the repetitions, `risenSiblings[].overtook` names what each sibling passed |
| `green` everywhere | neither symptom reproduced under the arrangements that were verified |
| `inconclusive` | the loop could not observe the scenario — arrangement never matched, no operator, or a missing reading. **Not** a pass |

A downstream fix is verified by the *same* command with the same contract: red
before, green after, same scenarios, same exit codes.

---

## Cleanup check

    node scripts/focus-loop.mjs cleanup

Sends a disarm to the relay and prints the one grep that shows the entire seam:

    grep -rn LILFOCUS extension mac scripts docs

The seam is **retained deliberately** as a test seam (#30 allows either). It is
behaviour-neutral by construction: inert until armed, armed only over the relay
socket (never from a page and never from storage, so a service-worker restart
disarms it), every arm carries a TTL of at most 30 minutes, nothing on the traced
path is awaited, and every failure is swallowed. Removing it entirely means
deleting the tagged sites that grep lists.

---

## Verification performed

### Tests

    pnpm test                       171 pass, 0 fail   (extension suite + harness suite)
    cd mac && swift test            167 pass, 0 fail   (17 suites)

New focused tests:

- `scripts/focus-loop/verdict.test.mjs` (11) — states each symptom as a window
  reading and requires red; states the intended behaviour and requires green.
- `scripts/focus-loop/replay.test.mjs` (3) — the whole path red end to end from a
  stored trace, deterministic, and still correct with the extension records
  stripped out.
- `scripts/focus-loop/scenarios.test.mjs` (5) — pins the coverage #30 asks for.
- `extension/test/focus-trace.test.js` (12) — the seam: inert until armed, TTL
  expiry, tagged and ordered records, contexts and restoration targets recorded,
  an unreachable collector leaving the traced path working, teardown closing only
  the named window and only while armed.

### Red-capable proof

    node scripts/focus-loop.mjs replay fixtures/focus-loop/synthetic-v04-symptoms.jsonl

    --- LILFOCUS verdict ---
      red          close/immediate (2/2)
      red          open/cross-display/no-other-lil (1/3)
      green        open/same-display/lil-on-primary-display (0/3)
      overall: red
    exit=1

`fixtures/focus-loop/synthetic-v04-symptoms.jsonl` is **synthetic** — hand-authored
window readings, not a real-Mac run; its first record says so. It exists to prove
the command reports these symptoms red end to end, and that green is still
reachable so the loop is not stuck red.

### Real-Mac run

    node scripts/focus-loop.mjs run
    → trace-2026-08-25T21-40-45-475Z.jsonl / verdict-2026-08-25T21-40-45-475Z.json

Environment: darwin 27.0.0 · Helium 0.15.7.1 · LilChromium v0.2-192-g6cf3671 ·
extension 0.4.0-trial · worktree 2caad30.

Ran unattended against the live v0.4 trial. The whole path worked: it activated
Mail, handed the URL to the default browser, watched a real lil appear
(CG window 45553, 1024×900 on display 0, front-to-back position 0) and read the
Primary window moving from position 3 to 4 — it did not rise, so
`open/cross-display/no-other-lil` scored **green** for that repetition.

`overall: inconclusive`. Nothing reproduced, and nothing was disproved, because:

- `seamLive: false` — the live browser loads the extension from
  `~/projects/lil-chromium-v0.4/extension`, not this worktree, so the seam is not
  present. Without it the loop cannot close the lil it opened, which caps it at
  one repetition per arrangement. Symptom 2 is intermittent; one repetition
  cannot settle it.
- The three close scenarios need a person at the terminal and were skipped.
- The remaining open arrangements need Mail and the Primary window on the same
  display, and a lil placed as a neighbour.

**Outstanding**: a full red-capable run with the seam live and an operator
present. Exact invocation in the next section.

---

## To finish the run

1. Point the loaded unpacked extension at this worktree's `extension/` directory
   and reload it, so the seam is live. (Also build this worktree's app and host
   if you want the `source: "host"` records; the loop decides correctly without
   them.)
2. Close every open lil.
3. Put Mail and the Helium Primary window on **different** displays to start; the
   loop prompts you to rearrange between scenarios.
4. From this worktree, in a real terminal:

```
node scripts/focus-loop.mjs run
```

5. Answer each `>>>` prompt with the exact gesture it names, then press Enter.
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
