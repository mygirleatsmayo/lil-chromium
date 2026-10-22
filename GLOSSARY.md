# Lil Chromium

Lil Chromium turns ordinary browser destinations into short-lived Chromium popup windows while preserving a clear relationship with the user's full browser.

## Language

**Lil Chromium**:
The macOS default-browser agent that coordinates lils and browser routing.
_Avoid_: Default browser, primary browser

**Lil**:
An ephemeral popup window of a Chromium browser.
_Avoid_: Popup, mini-browser

**Primary browser**:
The user's preferred Chromium browser for new lils and promotions.
_Avoid_: Default browser, main browser, connected browser

**Fallback browser**:
The Chromium browser used when the primary browser is unavailable.
_Avoid_: Backup browser

**Host browser**:
The Chromium browser containing a particular lil.
_Avoid_: Connected browser, primary browser

**Browser product**:
A named Chromium browser family, such as Chrome or Brave.
_Avoid_: Browser installation, browser profile

**Browser installation**:
An independently installed browser app or release channel that Lil Chromium can target, such as Chrome Beta.
_Avoid_: Browser product, browser profile

**Browser profile**:
A user-data context within one browser installation. Profiles are not independent routing targets in v0.4.
_Avoid_: Browser installation

**Prior context**:
The live context macOS should reveal after a focused lil closes, treating each lil as if it were an independent app. It follows the user's focus history across lils, normal browser windows, and external apps; it is not permanently fixed when the lil is created.
_Avoid_: Opener, creation-time predecessor, previous browser window

**Lil Nap**:
The feature and resource-saving inactive state from which a lil can later wake. User-facing actions say “Let This Lil Nap” and “Wake This Lil.”
_Avoid_: Nap this lil, Sleep, sleeping lil

**Reveal zone**:
The configurable top-edge region of a lil's web content that reveals its hoverbar.
_Avoid_: Expose target, hit target

**Global setting**:
A preference that applies across every browser installation and profile and is edited in Lil Chromium's native Settings.
_Avoid_: Extension setting

**Per-lil override**:
A contextual preference that changes one lil without changing the global default.
_Avoid_: Global setting
