// LILFOCUS native side (issue #30).
//
// Everything the loop does through macOS rather than through the browser: the
// z-order reading, the host's own log, and the two gestures the harness can
// perform itself. Public API only — `/usr/bin/open` is the real default-browser
// path, and the probe uses public CoreGraphics (see mac/Sources/LilFocusProbe).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const STATE_DIR = path.join(os.homedir(), ".lilchromium");
const TAG = "LILFOCUS";

/** The probe binary, built on first use. */
export function probeBinary(repoRoot) {
  const candidates = ["release", "debug"].map((c) => path.join(repoRoot, "mac/.build", c, "lil-focus-probe"));
  const existing = candidates.find((p) => fs.existsSync(p));
  if (existing) return existing;
  process.stderr.write("building lil-focus-probe (first run only)…\n");
  execFileSync("swift", ["build", "-c", "release", "--product", "lil-focus-probe"], {
    cwd: path.join(repoRoot, "mac"),
    stdio: "inherit",
  });
  return candidates[0];
}

/** One native reading: the frontmost application and every window front-to-back. */
export async function probe(binary, label) {
  const { stdout } = await execFileAsync(binary, [label]);
  return JSON.parse(stdout);
}

export async function activateApp(bundleId) {
  await execFileAsync("/usr/bin/open", ["-b", bundleId]);
}

/** Open a lil exactly the way a link click does: hand the URL to the default browser. */
export async function openLilThroughProduct(url) {
  await execFileAsync("/usr/bin/open", ["-g", url]);
}

/**
 * A cursor over one browser's host log that yields the new `[LILFOCUS]` lines
 * each time it is drained. The host truncates its log at 1MB, so a shrunken
 * file restarts from the top.
 */
export function hostLogTail(browser) {
  const file = path.join(STATE_DIR, `host-${browser}.log`);
  const sizeOf = () => {
    try {
      return fs.statSync(file).size;
    } catch (_) {
      return null;
    }
  };
  let offset = sizeOf() || 0;

  return function drain() {
    const size = sizeOf();
    if (size === null) return [];
    const from = size < offset ? 0 : offset;
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(size - from);
    fs.readSync(fd, buffer, 0, buffer.length, from);
    fs.closeSync(fd);
    offset = size;

    return buffer
      .toString("utf8")
      .split("\n")
      .filter((line) => line.includes(`[${TAG}]`))
      .map((line) => ({ tag: TAG, source: "host", t: Date.now(), event: "host-log", detail: { line } }));
  };
}

/** Pin what the run actually exercised — versions decided the last QA round. */
export function environment(repoRoot, { browser }) {
  const read = (fn, fallback = null) => {
    try {
      return fn();
    } catch (_) {
      return fallback;
    }
  };
  const appVersion = (app) =>
    execFileSync("/usr/bin/defaults", ["read", `/Applications/${app}.app/Contents/Info`, "CFBundleShortVersionString"])
      .toString()
      .trim();

  return {
    platform: `${os.platform()} ${os.release()}`,
    browserVersion: read(() => appVersion(browser === "helium" ? "Helium" : browser)),
    appVersion: read(() => appVersion("LilChromium")),
    extensionVersion: read(
      () => JSON.parse(fs.readFileSync(path.join(repoRoot, "extension/manifest.json"), "utf8")).version_name
    ),
    worktreeCommit: read(() => execFileSync("git", ["-C", repoRoot, "rev-parse", "--short", "HEAD"]).toString().trim()),
  };
}
