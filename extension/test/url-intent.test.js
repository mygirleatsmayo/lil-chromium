import { test } from "node:test";
import assert from "node:assert/strict";
import { boot } from "./harness.js";
import { fixture } from "./fixture.js";

// The hoverbar follows the palette's URL-intent contract (#39, PROTOCOL.md
// *URL intent*): the Swift suite runs the same fixture.
const { cases, search, home } = fixture("url-intent");

async function lilWithKagi() {
  const env = await boot();
  await env.deliver(fixture("message-context")); // search engine: Kagi
  await env.deliver({ type: "open", url: "https://lil.example/", left: 10, top: 10 });
  const lil = env.windows()[0];
  const navigate = (msg) => env.message({ action: "navigate", ...msg }, { tab: { id: lil.tabs[0].id, windowId: lil.id } });
  return { env, lil, navigate };
}

// Fixture search inputs carry no surrounding whitespace, so each is its query.
function assertSearched(reply, query) {
  const url = new URL(reply.url);
  assert.equal(url.origin + url.pathname, "https://kagi.com/search", `${query} searches`);
  assert.equal(url.searchParams.get("q"), query);
}

test("Return in the address field opens what the shared fixture resolves, else searches", async () => {
  const { env, lil, navigate } = await lilWithKagi();
  for (const c of cases) {
    const before = env.journal().length;
    const reply = await navigate({ input: c.input });
    if (c.open) {
      assert.equal(reply.url, c.open, c.input);
      assert.equal(env.windows()[0].tabs[0].url, c.open, `${c.input} navigates the lil`);
    } else if (c.search) {
      assertSearched(reply, c.input);
    } else {
      assert.equal(c.none, true, `fixture case ${JSON.stringify(c)} names a result`);
      assert.equal(reply.ok, false, "empty input has no destination");
      assert.equal(
        env.journal().slice(before).some((e) => e.op === "tabs.update" && e.tabId === lil.tabs[0].id),
        false,
        "empty input leaves the lil where it is"
      );
    }
  }
});

test("a home-directory path searches: an extension cannot know the home directory", async () => {
  const { navigate } = await lilWithKagi();
  for (const c of home.cases) assertSearched(await navigate({ input: c.input }), c.input);
});

test("searches build the URL the shared fixture names: the typed text is one query value", async () => {
  const { env, navigate } = await lilWithKagi();
  for (const c of search.cases) {
    const template = c.template ?? search.template;
    await env.deliver({ ...fixture("message-context"), searchEngine: { name: "Engine", template } });
    assert.equal((await navigate({ search: c.input })).url, c.url, `${c.input} with ${template}`);
  }
});

test("the Search row searches even for text that names a destination", async () => {
  const { navigate } = await lilWithKagi();
  assertSearched(await navigate({ search: "localhost" }), "localhost");
});
