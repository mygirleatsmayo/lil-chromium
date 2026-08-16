# Issue #6 — Catalog every supported browser installation

## What landed

One catalog in `BrowserTable` (`mac/Sources/LilShared/Browsers.swift`): 22 installations, each with slug, display name, bundle id, product, host-detection needles, and native-host support dir.

- App scan (`BrowserCatalog`) writes that full set into `knownBrowsers`; Launch Services only flips `installed`.
- Host parent detection uses the same needles (longest-first).
- `scripts/install-host.sh` writes manifests for the same support dirs, only when the dir already exists.
- `docs/PROTOCOL.md` lists the same table. The extension does not hardcode slugs; it consumes `knownBrowsers` from context and already hides `installed: false` entries from the caret menu.

Stable-channel slugs (`chrome`, `brave`, `edge`, `vivaldi`, `helium`, `arc`, `chromium`) are unchanged so existing `config.json` values keep working. Channels get suffixed slugs (`chrome-beta`, `brave-nightly`, …).

## Criteria

1. **Full set** — Chrome Stable/Beta/Dev/Canary; Brave Stable/Beta/Dev/Nightly; Edge Stable/Beta/Dev/Canary; Vivaldi Stable/Snapshot; Opera Stable/GX/Developer; Helium; Arc; Dia; Comet; Chromium. Locked by `BrowserTableTests.catalogIsTheFullSupportedSet`.
2. **Identity per installation** — slug, name, bundle id, detection needles, native-host dir. `everyInstallationHasStableIdentity` + uniqueness checks.
3. **Sibling channels stay separate** — distinct slug, bundle id, and support dir per product. Detection needles do not cross-match; Chrome Beta's real helper path (`Google Chrome Helper.app` inside `Google Chrome Beta.app`) resolves to `chrome-beta`, not `chrome`.
4. **Profiles are not routing targets** — no catalog field names a profile; installer does not write into `Default` / `Profile 1` / unknown dirs.
5. **Agreement** — `PROTOCOL.md` names every slug, bundle id, and support dir; `install-host.sh` `BROWSER_DIRS` equals `BrowserTable.nativeHostSupportDirectories`; Settings picker uses `installedChoices` (installed only); extension already filters the same flag.
6. **Automated checks** — catalog tests above; `NativeHostManifestTests` parses the installer list, runs `install-host.sh` against a fake `HOME` covering the full set, and checks generated JSON (`name`, `type`, `path`, `allowed_origins`).
7. **Unavailable stays known** — scan returns every catalog entry; missing bundle ids get `installed: false` and drop out of `installedChoices`.

## Judged out of scope

- Chrome for Testing and other Chromium derivatives not named in criterion 1.
- Hardcoding the catalog in `extension/` (it already treats `knownBrowsers` as truth).
- README / CHANGELOG (Lucas's prose).
- Rewriting Brave manifests into Chrome's NativeMessagingHosts directory (KeePassXC reports Brave sometimes reads Chrome's dir; this repo already used `BraveSoftware/Brave-Browser` and criterion 5 says keep one catalog, not change Brave's historical path).

## Unverified OS facts

Dia and Comet were not installed on the probe machine.

- **Dia** native-host dir is `Dia/User Data`, matching Arc (same vendor; Chromium `Local State` lives under `User Data`). Some tools also write `Dia/NativeMessagingHosts`. Not probed.
- **Comet** native-host dir is `ai.perplexity.comet`, matching Helium's bundle-id support dir. Some tools mention `Comet/` as well. Not probed.

If either is wrong, it is a one-line catalog fix plus the PROTOCOL/installer rows the tests keep in lockstep.

## No PROTOCOL conflict

Criterion 1 expands the slug list that PROTOCOL previously documented. Criterion 5 requires PROTOCOL to agree, so the document was updated rather than treated as a contradiction.

## Verified

- `swift build` (mac/)
- `swift test` (mac/) — 69 tests, 9 suites
- `make app`
