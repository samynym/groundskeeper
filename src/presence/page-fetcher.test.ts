import { describe, it, expect } from "vitest";
import { fetchPage, extractPhrase } from "./page-fetcher.js";

describe("fetchPage", () => {
  it("returns status and html on 200", async () => {
    const f = async () => ({ status: 200, text: async () => "<p>hi</p>" });
    expect(await fetchPage("https://x.test/p", f)).toEqual({ status: 200, html: "<p>hi</p>" });
  });
  it("returns empty html on non-200 without reading the body", async () => {
    const f = async () => ({ status: 404, text: async () => { throw new Error("should not read"); } });
    expect(await fetchPage("https://x.test/p", f)).toEqual({ status: 404, html: "" });
  });
  it("degrades a network error to status 0, never throws", async () => {
    const f = async () => { throw new Error("ECONNREFUSED"); };
    expect(await fetchPage("https://x.test/p", f)).toEqual({ status: 0, html: "" });
  });
});

describe("extractPhrase", () => {
  const LONG = "Modern MOON guidelines have you full weight-bearing from day one, with crutches used for balance rather than offloading.";
  it("picks the longest sentence within 80-200 chars from tag-stripped text", () => {
    const html = `<nav>Home</nav><script>var x = "Ignore this scripted sentence that is definitely long enough to qualify.";</script><p>Short one.</p><p>${LONG}</p>`;
    expect(extractPhrase(html)).toBe(LONG);
  });
  it("rejects sentences containing double quotes (they break the R3 query template)", () => {
    const quoted = 'This sentence has a "quoted fragment" inside it and is long enough to pass the eighty character floor easily.';
    expect(extractPhrase(`<p>${quoted}</p><p>${LONG}</p>`)).toBe(LONG);
  });
  it("returns null when no sentence fits the bounds", () => {
    expect(extractPhrase("<p>Too short.</p>")).toBeNull();
    expect(extractPhrase("")).toBeNull();
  });
  it("decodes basic entities so the phrase matches rendered text", () => {
    const html = "<p>Recovery isn&#39;t linear and the first weeks after surgery are usually the hardest part of the whole rehabilitation journey.</p>";
    expect(extractPhrase(html)).toContain("isn't");
  });
});
