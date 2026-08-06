#!/usr/bin/env bash
#
# bundle-app.sh — build LilChromium and assemble a .app bundle WITHOUT Xcode.
#
# Produces:  mac/build/LilChromium.app
# Contains:  Contents/MacOS/LilChromiumApp    (menu-bar agent, CFBundleExecutable)
#            Contents/MacOS/lilchromium-host  (native messaging host)
#            Contents/Info.plist, Contents/PkgInfo
#
# Requirements: a Swift toolchain (swift build) on macOS. Run from anywhere.

set -euo pipefail

# --- Resolve paths -----------------------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
MAC_DIR="$(cd -- "${SCRIPT_DIR}/../mac" >/dev/null 2>&1 && pwd)"

APP_NAME="LilChromium"
APP_EXECUTABLE="LilChromiumApp"
HOST_EXECUTABLE="lilchromium-host"
BUNDLE_ID="com.lilchromium.app"
VERSION="0.1.0"

BUILD_DIR="${MAC_DIR}/build"
APP_BUNDLE="${BUILD_DIR}/${APP_NAME}.app"
CONTENTS="${APP_BUNDLE}/Contents"
MACOS_DIR="${CONTENTS}/MacOS"
RESOURCES_DIR="${CONTENTS}/Resources"

# --- Build -------------------------------------------------------------------
echo "==> Building (swift build -c release) in ${MAC_DIR}"
( cd "${MAC_DIR}" && swift build -c release )

BIN_DIR="$( cd "${MAC_DIR}" && swift build -c release --show-bin-path )"
APP_BIN="${BIN_DIR}/${APP_EXECUTABLE}"
HOST_BIN="${BIN_DIR}/${HOST_EXECUTABLE}"

if [[ ! -x "${APP_BIN}" ]]; then
  echo "error: app binary not found at ${APP_BIN}" >&2
  exit 1
fi
if [[ ! -x "${HOST_BIN}" ]]; then
  echo "error: host binary not found at ${HOST_BIN}" >&2
  exit 1
fi

# --- Assemble bundle ---------------------------------------------------------
echo "==> Assembling ${APP_BUNDLE}"
rm -rf "${APP_BUNDLE}"
mkdir -p "${MACOS_DIR}" "${RESOURCES_DIR}"

cp "${APP_BIN}" "${MACOS_DIR}/${APP_EXECUTABLE}"
cp "${HOST_BIN}" "${MACOS_DIR}/${HOST_EXECUTABLE}"
chmod +x "${MACOS_DIR}/${APP_EXECUTABLE}" "${MACOS_DIR}/${HOST_EXECUTABLE}"

# --- Info.plist --------------------------------------------------------------
# CFBundleURLTypes (http+https) + CFBundleDocumentTypes (public.html/xhtml) are
# what make macOS list the app in the default-browser picker (verified: both
# are required on Big Sur+).
cat > "${CONTENTS}/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>${BUNDLE_ID}</string>
	<key>CFBundleName</key>
	<string>${APP_NAME}</string>
	<key>CFBundleDisplayName</key>
	<string>${APP_NAME}</string>
	<key>CFBundleExecutable</key>
	<string>${APP_EXECUTABLE}</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>${VERSION}</string>
	<key>CFBundleVersion</key>
	<string>${VERSION}</string>
	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<key>LSUIElement</key>
	<true/>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSUserActivityTypes</key>
	<array>
		<string>NSUserActivityTypeBrowsingWeb</string>
	</array>
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>Web URL</string>
			<key>CFBundleTypeRole</key>
			<string>Editor</string>
			<key>LSHandlerRank</key>
			<string>Default</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>http</string>
				<string>https</string>
			</array>
		</dict>
	</array>
	<key>CFBundleDocumentTypes</key>
	<array>
		<dict>
			<key>CFBundleTypeName</key>
			<string>HTML document</string>
			<key>CFBundleTypeRole</key>
			<string>Viewer</string>
			<key>LSHandlerRank</key>
			<string>Default</string>
			<key>LSItemContentTypes</key>
			<array>
				<string>public.html</string>
			</array>
		</dict>
		<dict>
			<key>CFBundleTypeName</key>
			<string>XHTML document</string>
			<key>CFBundleTypeRole</key>
			<string>Viewer</string>
			<key>LSHandlerRank</key>
			<string>Default</string>
			<key>LSItemContentTypes</key>
			<array>
				<string>public.xhtml</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
PLIST

# --- PkgInfo -----------------------------------------------------------------
printf 'APPL????' > "${CONTENTS}/PkgInfo"

# --- Codesign (ad-hoc) -------------------------------------------------------
echo "==> Codesigning (ad-hoc)"
codesign --force --deep --sign - "${APP_BUNDLE}"

# --- Register with Launch Services so it appears in the browser picker -------
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [[ -x "${LSREGISTER}" ]]; then
  echo "==> Registering with Launch Services"
  "${LSREGISTER}" -f "${APP_BUNDLE}" || true
fi

echo ""
echo "Done: ${APP_BUNDLE}"
echo ""
echo "Hint: for the default-browser picker to reliably show LilChromium, copy it"
echo "      to /Applications and register it there:"
echo ""
echo "        cp -R \"${APP_BUNDLE}\" /Applications/"
echo "        \"${LSREGISTER}\" -f /Applications/${APP_NAME}.app"
echo ""
echo "      Then install the native-messaging host manifest:"
echo ""
echo "        scripts/install-host.sh"
echo ""
