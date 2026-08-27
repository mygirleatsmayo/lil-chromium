---
status: accepted
supersedes: ADR-0003
---

# Follow ordinary macOS focus history

A lil shares a Chromium process with sibling windows, but Lil Chromium treats it like an independent app for focus. Closing a focused lil must reveal the live context macOS would have returned to if that lil were its own app—the context preceding its current user-focused run—not a predecessor frozen at creation or Chromium's incidental internal key window. This ordinary GUI behavior is worth explicitly modeling across the app, host, and extension boundary.
