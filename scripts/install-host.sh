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
# EXISTING browser support dir among the known set (Chrome/Beta/Canary, Helium,
# Brave, Edge, Arc, Vivaldi, Chromium). A dir is "existing" when its PARENT
# support directory exists; the NativeMessagingHosts subdir is created as
# needed. Helium does NOT read Chrome's manifests, so its own dir is required.

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
# gets its own NativeMessagingHosts/<HOST_NAME>.json. Mirrors PROTOCOL.md.
BROWSER_DIRS=(
  "Google/Chrome"
  "Google/Chrome Beta"
  "Google/Chrome Canary"
  "net.imput.helium"
  "BraveSoftware/Brave-Browser"
  "Microsoft Edge"
  "Arc/User Data"
  "Vivaldi"
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
  # A browser is "installed / has a profile" when its support dir exists (i.e.
  # the parent of NativeMessagingHosts). Only write where that parent exists.
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
