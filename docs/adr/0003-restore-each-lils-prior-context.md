# Restore each lil's prior context

Each lil records the exact context that preceded it and restores that context when it closes: a live predecessor lil, the related normal browser window, or the external macOS app. This per-lil chain replaces Chromium's incidental most-recent-window behavior so nested lils unwind predictably without raising unrelated browser windows.
