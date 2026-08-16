#!/usr/bin/env bash
#
# install-host.sh — write the native-messaging host manifest so each installed
# Chromium-family browser can launch lilchromium-host when the extension calls
# connectNative().
#
# Manifest name: com.lilchromium.relay
# Default host path: /Applications/LilChromium.app/Contents/MacOS/lilchromium-host
#
# Usage:
#   scripts/install-host.sh [APP_PATH]
#     APP_PATH  optional path to LilChromium.app (defaults to /Applications).
#
# Per docs/PROTOCOL.md installer contract: writes the manifest into every
# EXISTING browser support dir in the catalog (each Chromium app / release
# channel). A dir is "existing" when that support directory exists; the
# NativeMessagingHosts subdir is created as needed. Missing installations are
# skipped, not created. Helium does NOT read Chrome's manifests, so its own
# dir is required. Channels do not share a support directory.

set -euo pipefail

HOST_NAME="com.lilchromium.relay"
EXTENSION_ID="oofeehjoocddelicpmnpbafmbalaakge"

APP_PATH="${1:-/Applications/LilChromium.app}"
HOST_BIN="${APP_PATH}/Contents/MacOS/lilchromium-host"

if [[ ! -e "${HOST_BIN}" ]]; then
  echo "warning: host binary not found at ${HOST_BIN}" >&2
  echo "         (the manifest will still be written; fix the path with:" >&2
  echo "          scripts/install-host.sh /path/to/LilChromium.app )" >&2
fi

SUPPORT_BASE="${HOME}/Library/Application Support"

# Browser support directories (relative to ~/Library/Application Support), each
# gets its own NativeMessagingHosts/<HOST_NAME>.json. Same set and order as
# BrowserTable.nativeHostSupportDirectories / PROTOCOL.md "Browser slugs".
BROWSER_DIRS=(
  "Google/Chrome"
  "Google/Chrome Beta"
  "Google/Chrome Dev"
  "Google/Chrome Canary"
  "BraveSoftware/Brave-Browser"
  "BraveSoftware/Brave-Browser-Beta"
  "BraveSoftware/Brave-Browser-Dev"
  "BraveSoftware/Brave-Browser-Nightly"
  "Microsoft Edge"
  "Microsoft Edge Beta"
  "Microsoft Edge Dev"
  "Microsoft Edge Canary"
  "Vivaldi"
  "Vivaldi Snapshot"
  "com.operasoftware.Opera"
  "com.operasoftware.OperaGX"
  "com.operasoftware.OperaDeveloper"
  "net.imput.helium"
  "Arc/User Data"
  "Dia/User Data"
  "ai.perplexity.comet"
  "Chromium"
)

write_manifest() {
  local browser_dir="$1"          # absolute path to the browser's support dir
  local label="$2"                # human-readable name for logging
  local nmh_dir="${browser_dir}/NativeMessagingHosts"
  local manifest="${nmh_dir}/${HOST_NAME}.json"

  mkdir -p "${nmh_dir}"
  cat > "${manifest}" <<JSON
{
  "name": "${HOST_NAME}",
  "description": "lil-chromium relay",
  "path": "${HOST_BIN}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXTENSION_ID}/"
  ]
}
JSON
  echo "  [${label}] wrote ${manifest}"
}

echo "==> Installing native-messaging host manifest (${HOST_NAME})"
echo "    host path: ${HOST_BIN}"

WROTE_ANY=0
INSTALLED=()
for rel in "${BROWSER_DIRS[@]}"; do
  browser_dir="${SUPPORT_BASE}/${rel}"
  # Only write where the installation's support directory already exists.
  if [[ -d "${browser_dir}" ]]; then
    write_manifest "${browser_dir}" "${rel}"
    INSTALLED+=("${rel}")
    WROTE_ANY=1
  fi
done

echo ""
if [[ "${WROTE_ANY}" -eq 0 ]]; then
  echo "No known Chromium-family browser support directories found under:"
  echo "  ${SUPPORT_BASE}"
  echo "Nothing was written. Launch a supported browser once, then re-run."
else
  echo "Installed the host manifest for: ${INSTALLED[*]}"
fi

echo ""
echo "Done. Reload the extension in each browser's extensions page if it was"
echo "already loaded so the service worker reconnects to the host."
