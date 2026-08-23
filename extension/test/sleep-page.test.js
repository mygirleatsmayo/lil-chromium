import { test } from "node:test";
import assert from "node:assert/strict";
import { mountSleepPage, flush } from "./sleep-page-harness.js";

const ORIGINAL_URL = "https://example.com/docs";
const ORIGINAL_TITLE = "Example Docs";
const CAPTURE_KEY = "7-1700000000000";
const WINDOW_KEY = "7";

test("a successful worker reply keeps the nap page on the worker's bounded transition", async () => {
  const page = await mountSleepPage({ reply: "ok" });
  page.click();
  await flush();
  assert.deepEqual(page.wakeMessages, [{ action: "wakeLil" }]);

  // No deadline of the page's own may navigate it: the worker owns the swap.
  await page.advance(5000);
  assert.equal(page.navigatedTo(), null);
  assert.equal(page.registry()[WINDOW_KEY].slept, true);
  assert.equal(page.captures().has(CAPTURE_KEY), true);
});

test("an explicit worker failure reconciles nap state before the page leaves", async () => {
  const page = await mountSleepPage({ reply: "fail" });
  page.click();
  await flush();

  // Cleanup is real work across the extension API boundary, so the page is
  // still here while it runs: leaving first would abandon it unfinished.
  assert.equal(page.navigatedTo(), null, "the page does not leave in the same turn it asks");

  await page.advance(149);
  assert.equal(page.navigatedTo(), ORIGINAL_URL, "cleanup landed, then the page left");
  const entry = page.registry()[WINDOW_KEY];
  assert.ok(entry, "the lil stays registered");
  assert.equal(entry.url, ORIGINAL_URL);
  assert.equal(entry.slept, undefined);
  assert.equal(entry.sleepCaptureKey, undefined);
  assert.equal(entry.originalUrl, undefined);
  assert.equal(entry.originalTitle, undefined);
  assert.equal(page.captures().has(CAPTURE_KEY), false, "the capture is removed");
});

test("the page fallback does not compete with the worker's bounded path at the 500ms deadline", async () => {
  const page = await mountSleepPage({ reply: "hang" });
  page.click();
  await flush();

  // The worker's reply is still pending through its whole bounded path: the
  // page must not navigate at the transition's own deadline.
  await page.advance(500);
  assert.equal(page.navigatedTo(), null, "no race against the worker at the same deadline");
  assert.equal(page.registry()[WINDOW_KEY].slept, true);
  assert.equal(page.captures().has(CAPTURE_KEY), true);

  // Silence well past the worker's cap is genuine unreachability: the page
  // goes directly rather than stranding, reconciling nap state itself.
  await page.advance(1000);
  assert.equal(page.navigatedTo(), ORIGINAL_URL);
  assert.equal(page.registry()[WINDOW_KEY].slept, undefined);
  assert.equal(page.captures().has(CAPTURE_KEY), false);
});

test("a worker message error (unreachable worker) runs the fallback with cleanup", async () => {
  const page = await mountSleepPage({ reply: "error" });
  page.click();
  await flush();
  await page.advance(149);

  assert.equal(page.navigatedTo(), ORIGINAL_URL);
  assert.equal(page.registry()[WINDOW_KEY].slept, undefined);
  assert.equal(page.registry()[WINDOW_KEY].sleepCaptureKey, undefined);
  assert.equal(page.captures().has(CAPTURE_KEY), false);
});

test("a thrown send (invalidated context) runs the fallback with cleanup", async () => {
  const page = await mountSleepPage({ reply: "throw" });
  page.click();
  await flush();
  await page.advance(149);

  assert.equal(page.navigatedTo(), ORIGINAL_URL);
  assert.equal(page.registry()[WINDOW_KEY].slept, undefined);
  assert.equal(page.captures().has(CAPTURE_KEY), false);
});

test("a hung storage API does not strand the nap document: the page navigates after a bounded wait", async () => {
  const page = await mountSleepPage({ reply: "fail", hangStorage: true });
  page.click();
  await flush();

  await page.advance(149);
  assert.equal(page.navigatedTo(), null, "the bound is a real wait, not an immediate departure");
  assert.equal(page.registry()[WINDOW_KEY].slept, true, "hung storage left nap fields in place");
  assert.equal(page.captures().has(CAPTURE_KEY), true);

  await page.advance(1);
  assert.equal(page.navigatedTo(), ORIGINAL_URL, "the bound lets the page leave without cleanup settling");
  assert.equal(page.registry()[WINDOW_KEY].slept, true, "eventual cleanup is not this page's job once hung");
  assert.equal(page.captures().has(CAPTURE_KEY), true, "the worker backstop and orphan sweep still own it");
});
