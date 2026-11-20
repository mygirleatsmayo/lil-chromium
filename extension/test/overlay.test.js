import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mountOverlay, OVERLAY_PATH } from "./overlay-harness.js";

test("boots the production overlay, not a copy", async () => {
  const page = await mountOverlay();
  assert.equal(path.basename(OVERLAY_PATH), "overlay.js");
  assert.equal(fs.realpathSync(page.overlayPath), fs.realpathSync(OVERLAY_PATH));
  assert.ok(page.host, "overlay mounts a host");
  assert.ok(page.addr, "overlay mounts the address field");
});

test("keystrokes in the focused address field do not reach page shortcut listeners", async () => {
  const page = await mountOverlay();
  const heard = [];
  page.document.addEventListener("keydown", (e) => heard.push(e.key));

  page.key(page.window, "l", { metaKey: true });
  assert.equal(page.root.activeElement === page.addr, true);

  const event = page.key(page.addr, "s");
  assert.deepEqual(heard, []);
  assert.equal(event.defaultPrevented, false);
});

test("page shortcuts still observe keys when the address field is not focused", async () => {
  const page = await mountOverlay();
  const heard = [];
  page.document.addEventListener("keydown", (e) => heard.push(e.key));
  page.key(page.document.body, "s");
  assert.deepEqual(heard, ["s"]);
});

test("Command+L reveals and focuses the address field when mouse reveal is disabled", async () => {
  const page = await mountOverlay({ hoverBar: { revealHeight: 0 } });
  page.chrome.pushContext({ hoverBar: { style: "glass", tint: null, revealHeight: 0 } });

  const move = new page.window.MouseEvent("mousemove", { bubbles: true, cancelable: true, clientY: 4 });
  page.document.dispatchEvent(move);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(page.bar.classList.contains("show"), false);

  page.key(page.window, "l", { metaKey: true });
  assert.equal(page.bar.classList.contains("show"), true);
  assert.equal(page.root.activeElement === page.addr, true);
  assert.equal(page.addr.classList.contains("hidden"), false);
});

test("Escape closes suggestions first and the hoverbar on the next Escape", async () => {
  const page = await mountOverlay();
  page.key(page.window, "l", { metaKey: true });
  page.addr.value = "git";
  page.addr.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  await page.flush();
  assert.equal(page.omni.classList.contains("open"), true);

  page.key(page.addr, "Escape");
  assert.equal(page.omni.classList.contains("open"), false);
  assert.equal(page.bar.classList.contains("show"), true);
  assert.equal(page.root.activeElement === page.addr, true);

  page.key(page.addr, "Escape");
  assert.equal(page.bar.classList.contains("show"), false);
});

test("arrow keys still navigate suggestions without leaking to the page", async () => {
  const page = await mountOverlay();
  const heard = [];
  page.document.addEventListener("keydown", (e) => heard.push(e.key));
  page.key(page.window, "l", { metaKey: true });
  page.addr.value = "git";
  page.addr.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  await page.flush();

  const down = page.key(page.addr, "ArrowDown");
  assert.equal(down.defaultPrevented, true);
  assert.equal(page.omni.querySelector(".orow.sel") != null, true);
  assert.deepEqual(heard, []);

  const back = page.key(page.addr, "Backspace");
  assert.equal(back.defaultPrevented, false);
});

test("clicking the Search row searches for the typed text, even when it names a destination (#39)", async () => {
  const page = await mountOverlay();
  page.key(page.window, "l", { metaKey: true });
  page.addr.value = "localhost";
  page.addr.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  await page.flush();

  const rows = page.omni.querySelectorAll(".orow");
  rows[rows.length - 1].dispatchEvent(new page.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  // Spread: the message is built in the overlay's realm.
  assert.deepEqual({ ...page.chrome.messages.at(-1) }, { action: "navigate", search: "localhost" });
});

for (const [label, emptied] of [
  ["emptying", ""],
  ["leaving only whitespace in", "\u0085"],
]) {
  test(`${label} the address field drops a suggestions reply still pending`, async () => {
    const page = await mountOverlay({ holdOmnibox: true });
    page.key(page.window, "l", { metaKey: true });
    page.addr.value = "git";
    page.addr.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(page.chrome.messages.at(-1).action, "omnibox", "the query for git is pending");

    page.addr.value = emptied;
    page.addr.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    page.chrome.releaseOmnibox();
    await page.flush();
    assert.equal(page.omni.classList.contains("open"), false, "the reply for git does not open suggestions");

    await new Promise((r) => setTimeout(r, 150));
    await page.flush();
    assert.equal(page.omni.classList.contains("open"), false, "nothing reopens them later");
  });
}

test("Escape drops a suggestions reply still pending", async () => {
  const page = await mountOverlay({ holdOmnibox: true });
  page.key(page.window, "l", { metaKey: true });
  page.addr.value = "git";
  page.addr.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  page.chrome.releaseOmnibox();
  await page.flush();
  assert.equal(page.omni.classList.contains("open"), true, "suggestions for git are open");

  page.addr.value = "gith";
  page.addr.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(page.chrome.messages.at(-1).query, "gith", "the query for gith is pending");

  page.key(page.addr, "Escape");
  assert.equal(page.root.activeElement === page.addr, true, "the first Escape only closes suggestions");
  page.chrome.releaseOmnibox();
  await page.flush();
  assert.equal(page.omni.classList.contains("open"), false, "the reply for gith does not reopen them");
});

test("Escape drops a suggestions query still waiting out the debounce", async () => {
  const page = await mountOverlay();
  page.key(page.window, "l", { metaKey: true });
  page.addr.value = "git";
  page.addr.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  await page.flush();
  assert.equal(page.omni.classList.contains("open"), true, "suggestions for git are open");

  page.addr.value = "gith";
  page.addr.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  page.key(page.addr, "Escape");
  await new Promise((r) => setTimeout(r, 150));
  await page.flush();
  assert.equal(page.omni.classList.contains("open"), false, "the query for gith does not reopen them");
});

test("keyboard isolation keeps address labels, pointer-transparent chrome, and Settings", async () => {
  const page = await mountOverlay();
  assert.equal(page.addr.getAttribute("aria-label"), "Address");
  assert.match(page.host.style.cssText, /pointer-events:\s*none/);
  assert.match(page.root.querySelector("style").textContent, /\.bar \{[\s\S]*?pointer-events:\s*auto/);
  assert.equal(page.root.querySelector(".caretbtn").getAttribute("aria-label"), "More options");
  page.key(page.window, "l", { metaKey: true });
  page.root.querySelector(".caretbtn").dispatchEvent(new page.window.Event("click", { bubbles: true }));
  await page.flush();
  const menu = page.root.querySelector(".menu");
  assert.match(menu.textContent, /Settings…/);
  const foot = menu.querySelector(".foot");
  const manifest = page.chrome.runtime.getManifest();
  assert.equal(foot.textContent, manifest.version_name || manifest.version);
  assert.equal(foot.getAttribute("role"), null);
});

// --- Functional icon system (issue #23) ---------------------------------

/** The bundled asset of record: one path per official Material Symbol. */
function bundledPath(symbol) {
  const file = path.resolve(
    fileURLToPath(new URL(`../assets/material-symbols/${symbol}.svg`, import.meta.url))
  );
  return /\bd="([^"]+)"/.exec(fs.readFileSync(file, "utf8"))[1];
}

/** Every icon the overlay draws must be one uniform, decorative svg element. */
function assertIconContract(svg, symbol) {
  assert.ok(svg, `expected an icon for ${symbol}`);
  assert.equal(svg.tagName.toLowerCase(), "svg");
  assert.ok(svg.classList.contains("ico"), `${symbol} carries the shared .ico class`);
  assert.equal(svg.getAttribute("viewBox"), "0 -960 960 960");
  assert.equal(svg.getAttribute("aria-hidden"), "true");
  assert.equal(svg.getAttribute("focusable"), "false");
  assert.equal(svg.querySelector("path").getAttribute("d"), bundledPath(symbol));
}

test("hoverbar controls draw bundled Material Symbols, not text glyphs", async () => {
  const page = await mountOverlay();
  const controls = {
    ".back": "arrow_back",
    ".reload": "refresh",
    ".copy": "link",
    ".caretbtn": "expand_more",
  };
  for (const [selector, symbol] of Object.entries(controls)) {
    const button = page.root.querySelector(selector);
    assert.ok(button, `${selector} exists`);
    assertIconContract(button.querySelector("svg"), symbol);
    assert.equal(button.textContent.trim(), "", `${selector} carries no text glyph`);
  }
  // One class and one custom property size every icon — no per-button rules.
  const css = page.root.querySelector("style").textContent;
  assert.match(css, /\.ico \{[\s\S]*?width: var\(--ico\)[\s\S]*?fill: currentColor/);
});

test("Copy URL sits inside the address field and keeps one accessible name", async () => {
  const page = await mountOverlay({ clock: true });
  const copy = page.root.querySelector(".addrwrap > .copy");
  assert.ok(copy, "Copy URL is a child of the address field wrapper");
  assert.equal(copy.getAttribute("aria-label"), "Copy URL");
  assert.equal(copy.getAttribute("title"), "Copy URL");

  page.click(copy);
  await page.flush();
  assert.deepEqual(page.clipboard.writes, ["https://example.com/docs"]);

  // Success is a brief glyph swap only — the name the control announces and
  // the name it shows on hover must not change underneath the user.
  assertIconContract(copy.querySelector("svg"), "check");
  assert.equal(copy.getAttribute("aria-label"), "Copy URL");
  assert.equal(copy.getAttribute("title"), "Copy URL");

  // Production copy feedback lasts 1200ms. Step just shy of that, then onto
  // the deadline, so a shorter or longer reset cannot pass by accident.
  await page.clock.advance(1199);
  assertIconContract(copy.querySelector("svg"), "check");
  await page.clock.advance(1);
  assertIconContract(copy.querySelector("svg"), "link");
});

test("copying from inside the field does not collapse an in-progress edit", async () => {
  const page = await mountOverlay();
  page.key(page.window, "l", { metaKey: true });
  page.addr.value = "half typed";
  assert.equal(page.root.activeElement === page.addr, true);

  // Suppressing the pointer default is what keeps focus in the field: the
  // control now lives inside it, so pressing Copy must not act like a blur.
  const down = page.click(page.root.querySelector(".copy"));
  await page.flush();
  assert.equal(down.defaultPrevented, true);
  assert.equal(page.root.activeElement === page.addr, true);
  assert.equal(page.addr.classList.contains("hidden"), false);
  assert.equal(page.addr.value, "half typed");
  assert.deepEqual(page.clipboard.writes, ["https://example.com/docs"]);
});

test("omnibox and menu rows use the same icon system as the bar", async () => {
  const page = await mountOverlay();
  page.key(page.window, "l", { metaKey: true });
  page.addr.value = "git";
  page.addr.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  await page.flush();

  const searchRow = [...page.omni.querySelectorAll(".orow")].find((row) =>
    /Search .+ for/.test(row.textContent)
  );
  assert.ok(searchRow, "the omnibox offers a search row");
  assertIconContract(searchRow.querySelector("svg"), "search");
  assert.doesNotMatch(page.omni.textContent, /[⌕⧉]/);

  page.click(page.root.querySelector(".caretbtn"));
  await page.flush();
  const menu = page.root.querySelector(".menu");
  const checked = menu.querySelector('[aria-checked="true"]');
  assert.ok(checked, "the menu marks a current choice");
  assertIconContract(checked.querySelector("svg.check"), "check");
  assert.doesNotMatch(menu.textContent, /[✓▾]/);
});

test("a lil on a local dev server gets the hoverbar", async () => {
  const page = await mountOverlay({ url: "http://localhost:5173/app" });
  assert.ok(page.bar, "localhost pages carry the hoverbar");
  assert.equal(page.urlDisplay.textContent, "localhost:5173/app");
});

test("a lil showing a local file gets the hoverbar and reports activity", async () => {
  const page = await mountOverlay({ url: "file:///Users/luke/Notes/index.html", clock: true });
  assert.ok(page.bar, "file pages carry the hoverbar");
  assert.ok(page.chrome.messages.some((m) => m.action === "interaction"));

  const field = page.document.createElement("textarea");
  page.document.body.appendChild(field);
  field.value = "draft";
  field.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  await page.clock.advance(500);
  assert.ok(page.chrome.messages.some((m) => m.action === "formDirty" && m.dirty === true));
});

test("a local file shows its decoded path, and the full URL when focused", async () => {
  const href = "file:///Users/luke/My%20Notes/index.html";
  const page = await mountOverlay({ url: href });
  assert.equal(page.urlDisplay.textContent, "/Users/luke/My Notes/index.html");
  assert.equal(page.urlDisplay.querySelector(".strong").textContent, "index.html");

  page.key(page.window, "l", { metaKey: true });
  assert.equal(page.addr.value, href);
});

test("a local file lil gets no hoverbar when the browser denies file access", async () => {
  const page = await mountOverlay({ url: "file:///Users/luke/index.html", fileAccess: false });
  assert.equal(page.host, null);
  assert.deepEqual(page.chrome.messages, []);
});
