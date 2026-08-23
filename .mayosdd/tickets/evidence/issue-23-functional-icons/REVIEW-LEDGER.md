# Issue #23 — frozen review ledger

- Original fixed point: `411d47983443915c1fa67c77285471db309676d2`
- Initial review head / pre-fix point: `bb3740de5f8d506da074c21e5f24a48f3c54095d`
- Sources: `REVIEW-STANDARDS.md`, `REVIEW-SPEC.md`

## Findings

- **S1** · `SettingsWindow.swift`: two warning-label modifier chains · **won't fix** — two small, local leaf views do not justify a new abstraction. Settled interpretation: this duplication is below the project's simplicity threshold unless a third use appears.
- **S2** · `extension/test/overlay.test.js`: copy-reset assertion waits 1.3 seconds of wall time and is coupled indirectly to `COPY_TICK_MS` · **fix** — make the existing test deterministic at the test boundary without exporting production internals or weakening the assertion.
- **P1** · focused native/hoverbar visual QA lacks real-Mac evidence · **won't fix in this code round; deferred to issue #26** — the final integrated QA ticket owns representative-scale, appearance, contrast, focus, and VoiceOver evidence. This is not a waiver of that release check and is not a code defect to re-raise during #23 remediation/final review.

## Settled scope

- Remediation may change only what S2 requires plus its evidence.
- S1 and P1 are final adjudications for #23's code-review loop.
- Later reviews must not reopen these interpretations; genuinely new defects remain reportable.
