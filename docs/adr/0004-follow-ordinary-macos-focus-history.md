---
status: accepted
supersedes: ADR-0003
---

# Follow ordinary macOS focus history

A lil shares a Chromium process with sibling windows, but Lil Chromium treats it like an independent app for focus. Closing a focused lil must reveal the live context macOS would have returned to if that lil were its own app—the context preceding its current user-focused run—not a predecessor frozen at creation or Chromium's incidental internal key window. This ordinary GUI behavior is worth explicitly modeling across the app, host, and extension boundary.

The same rule names the external app: it is the app the user actually left before the lil's current focused run, which only the host can observe (Chromium reports no focused window, nothing more), so the host resolves it from its own activation history at close time. The process the app recorded when the lil opened is a fallback for a host with no history, never the answer in its own right.
