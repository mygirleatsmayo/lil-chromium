# Keep global settings native

Although many preferences control extension behavior, Lil Chromium exposes every global setting in one native Settings window and keeps `config.json` as shared truth. Lil UI contains only contextual actions, per-lil overrides, and a way to open native Settings, avoiding duplicated controls and cross-browser divergence.
