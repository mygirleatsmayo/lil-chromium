import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared contract fixtures. One set of bytes for every consumer: this Node
 * suite and `mac/Tests/LilChromiumTests/Fixture.swift` both read repo-root
 * `fixtures/`. Location is derived from this source file — never `$HOME`
 * and never `process.cwd()`.
 */
export function fixtureDirectory() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");
}

export function fixturePath(name) {
  return path.join(fixtureDirectory(), `${name}.json`);
}

export function fixtureBytes(name) {
  const file = fixturePath(name);
  try {
    return fs.readFileSync(file);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error(`fixture fixtures/${name}.json not found (looked in ${fixtureDirectory()})`);
    }
    throw err;
  }
}

export function fixture(name) {
  return JSON.parse(fixtureBytes(name).toString("utf8"));
}
