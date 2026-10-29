# Route browser installations, not profiles

Lil Chromium treats each independently installed browser app or release channel as its own routing target, while browser profiles remain internal to that installation in v0.4. This makes socket identity and fallback launching deterministic without claiming profile or incognito provenance that generic macOS URL events do not provide.
