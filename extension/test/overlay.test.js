import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

test("keyboard isolation keeps address labels, pointer-transparent chrome, and Settings", async () => {
  const page = await mountOverlay();
  assert.equal(page.addr.getAttribute("aria-label"), "Address");
  assert.match(page.host.style.cssText, /pointer-events:\s*none/);
  assert.match(page.root.querySelector("style").textContent, /\.bar \{[\s\S]*?pointer-events:\s*auto/);
  assert.equal(page.root.querySelector(".caretbtn").getAttribute("aria-label"), "More options");
  page.key(page.window, "l", { metaKey: true });
  page.root.querySelector(".caretbtn").dispatchEvent(new page.window.Event("click", { bubbles: true }));
  await page.flush();
  assert.match(page.root.querySelector(".menu").textContent, /Settings…/);
});
