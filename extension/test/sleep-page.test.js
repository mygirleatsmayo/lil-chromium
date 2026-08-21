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
  page.fireTimers(() => true);
  await flush();
  assert.equal(page.navigatedTo(), null);
  assert.equal(page.registry()[WINDOW_KEY].slept, true);
  assert.equal(page.captures().has(CAPTURE_KEY), true);
});

test("an explicit worker failure runs the page fallback at once and reconciles nap state", async () => {
  const page = await mountSleepPage({ reply: "fail" });
  page.click();
  await flush();

  assert.equal(page.navigatedTo(), ORIGINAL_URL, "the page goes directly without waiting out a deadline");
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
  page.fireTimers((ms) => ms <= 500);
  await flush();
  assert.equal(page.navigatedTo(), null, "no race against the worker at the same deadline");
  assert.equal(page.registry()[WINDOW_KEY].slept, true);
  assert.equal(page.captures().has(CAPTURE_KEY), true);

  // Silence well past the worker's cap is genuine unreachability: the page
  // goes directly rather than stranding, reconciling nap state itself.
  page.fireTimers(() => true);
  await flush();
  assert.equal(page.navigatedTo(), ORIGINAL_URL);
  assert.equal(page.registry()[WINDOW_KEY].slept, undefined);
  assert.equal(page.captures().has(CAPTURE_KEY), false);
});

test("a worker message error (unreachable worker) runs the fallback at once with cleanup", async () => {
  const page = await mountSleepPage({ reply: "error" });
  page.click();
  await flush();

  assert.equal(page.navigatedTo(), ORIGINAL_URL);
  assert.equal(page.registry()[WINDOW_KEY].slept, undefined);
  assert.equal(page.registry()[WINDOW_KEY].sleepCaptureKey, undefined);
  assert.equal(page.captures().has(CAPTURE_KEY), false);
});

test("a thrown send (invalidated context) runs the fallback at once with cleanup", async () => {
  const page = await mountSleepPage({ reply: "throw" });
  page.click();
  await flush();

  assert.equal(page.navigatedTo(), ORIGINAL_URL);
  assert.equal(page.registry()[WINDOW_KEY].slept, undefined);
  assert.equal(page.captures().has(CAPTURE_KEY), false);
});
