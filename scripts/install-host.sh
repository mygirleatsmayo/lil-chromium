#!/usr/bin/env bash
#
# install-host.sh — write the Chrome native-messaging host manifest so Chrome
# can launch lilchromium-host when the extension calls connectNative().
#
# Manifest name: com.lilchromium.relay
# Default host path: /Applications/LilChromium.app/Contents/MacOS/lilchromium-host
#
# Usage:
#   scripts/install-host.sh [APP_PATH]
#     APP_PATH  optional path to LilChromium.app (defaults to /Applications).
#
# Writes the manifest for Chrome, Chrome Beta, and Chrome Canary if those
# profile directories exist (harmless if they don't).

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

SUPPORT_BASE="${HOME}/Library/Application Support/Google"

# Candidate Chrome channel directories.
CHANNELS=(
  "Chrome"
  "Chrome Beta"
  "Chrome Canary"
)

write_manifest() {
  local channel_dir="$1"
  local nmh_dir="${channel_dir}/NativeMessagingHosts"
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
  echo "  wrote ${manifest}"
}

echo "==> Installing native-messaging host manifest (${HOST_NAME})"
echo "    host path: ${HOST_BIN}"

WROTE_ANY=0
for channel in "${CHANNELS[@]}"; do
  channel_dir="${SUPPORT_BASE}/${channel}"
  # Always write for stable Chrome; write for Beta/Canary only if present.
  if [[ "${channel}" == "Chrome" ]] || [[ -d "${channel_dir}" ]]; then
    write_manifest "${channel_dir}"
    WROTE_ANY=1
  fi
done

if [[ "${WROTE_ANY}" -eq 0 ]]; then
  echo "  (no Chrome channels found; wrote nothing)"
fi

echo ""
echo "Done. Reload the extension in chrome://extensions if it was already loaded"
echo "so the service worker reconnects to the host."
