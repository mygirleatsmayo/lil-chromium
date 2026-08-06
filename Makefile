# lil-chromium — build & install
# Usage: make app && make install-app && make install-host
# Then load extension/ unpacked in Chrome (see README).

APP_BUILD := mac/build/LilChromium.app
APP_DEST  := /Applications/LilChromium.app

.PHONY: app install-app install-host install clean

app:
	bash scripts/bundle-app.sh

install-app:
	@test -d "$(APP_BUILD)" || { echo "Run 'make app' first."; exit 1; }
	rm -rf "$(APP_DEST)"
	cp -R "$(APP_BUILD)" "$(APP_DEST)"
	/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$(APP_DEST)" || true
	@echo "Installed $(APP_DEST)"

install-host:
	bash scripts/install-host.sh

install: app install-app install-host
	@echo ""
	@echo "Next: load the extension (README step 3), then set default browser from the menu bar icon."

clean:
	rm -rf mac/.build mac/build
