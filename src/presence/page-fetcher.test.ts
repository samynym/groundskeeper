import { describe, it, expect } from "vitest";
import { fetchPage, extractPhrase, BROWSER_HEADERS } from "./page-fetcher.js";

describe("BROWSER_HEADERS", () => {
  // Regression guard: a bare (UA-less) liveness fetch is 403'd by Vercel from
  // the cloud egress, which false-fails the whole probe as PAGE_NOT_LIVE.
  it("presents a real browser User-Agent", () => {
    expect(BROWSER_HEADERS["User-Agent"]).toMatch(/Mozilla\/5\.0/);
    expect(BROWSER_HEADERS.Accept).toContain("text/html");
  });
});

describe("fetchPage", () => {
  const ok = (body: string): (() => Promise<{ status: number; text(): Promise<string> }>) =>
    async () => ({ status: 200, text: async () => body });
  const code = (status: number) =>
    async () => ({ status, text: async () => { throw new Error("body should not be read"); } });
  const boom = async () => { throw new Error("ECONNREFUSED"); };
  const neverCalled = async () => { throw new Error("proxy should not be called on a direct 200"); };

  it("uses the direct fetch on 200 and never hits the proxy", async () => {
    expect(await fetchPage("https://x.test/p", ok("<p>hi</p>"), neverCalled))
      .toEqual({ status: 200, html: "<p>hi</p>" });
  });
  it("falls back to the proxy when the direct fetch is blocked (403)", async () => {
    expect(await fetchPage("https://x.test/p", code(403), ok("<p>proxied</p>")))
      .toEqual({ status: 200, html: "<p>proxied</p>" });
  });
  it("falls back to the proxy when the direct fetch throws", async () => {
    expect(await fetchPage("https://x.test/p", boom, ok("<p>proxied</p>")))
      .toEqual({ status: 200, html: "<p>proxied</p>" });
  });
  it("stays not-live (reports the status) when both direct and proxy fail", async () => {
    expect(await fetchPage("https://x.test/p", code(403), code(403)))
      .toEqual({ status: 403, html: "" });
  });
  it("degrades a proxy network error to status 0, never throws", async () => {
    expect(await fetchPage("https://x.test/p", code(403), boom))
      .toEqual({ status: 0, html: "" });
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
  it("decodes typographic entities like &rsquo; to their Unicode equivalents", () => {
    const html = "<p>Recovery isn&rsquo;t linear and after hip surgery rehabilitation usually takes weeks or months to see meaningful progress.</p>";
    const phrase = extractPhrase(html);
    expect(phrase).toBeTruthy();
    expect(phrase).toContain("isn’t"); // U+2019 = RIGHT SINGLE QUOTATION MARK (curly apostrophe)
  });
  it("decodes decimal numeric entities like &#8217;", () => {
    const html = "<p>Recovery isn&#8217;t linear and after hip surgery rehabilitation usually takes weeks or months to see meaningful progress.</p>";
    const phrase = extractPhrase(html);
    expect(phrase).toBeTruthy();
    expect(phrase).toContain("isn’t"); // U+2019 = RIGHT SINGLE QUOTATION MARK
  });
  it("decodes hex numeric entities like &#x2019;", () => {
    const html = "<p>Recovery isn&#x2019;t linear and after hip surgery rehabilitation usually takes weeks or months to see meaningful progress.</p>";
    const phrase = extractPhrase(html);
    expect(phrase).toBeTruthy();
    expect(phrase).toContain("isn’t"); // U+2019 = RIGHT SINGLE QUOTATION MARK
  });
  it("treats &amp;#39; (double-encoded) as literal &#39; text, not an apostrophe", () => {
    // This represents actual page text that shows "&#39;" literally
    const html = "<p>Recovery isn&amp;#39;t linear and after hip surgery rehabilitation usually takes weeks or months to see meaningful progress.</p>";
    const phrase = extractPhrase(html);
    expect(phrase).toBeTruthy();
    expect(phrase).toContain("&#39;");
    expect(phrase).not.toContain("isn't");
  });
  it("allows curly quotes from &ldquo; and &rdquo; entities (only straight quotes break the query template)", () => {
    const html = "<p>The doctor said &ldquo;you are healing well&rdquo; and it motivated me to push harder during the long recovery period after my hip surgery.</p>";
    const phrase = extractPhrase(html);
    expect(phrase).toBeTruthy();
    expect(phrase).toContain("“"); // U+201C = LEFT DOUBLE QUOTATION MARK
    expect(phrase).toContain("”"); // U+201D = RIGHT DOUBLE QUOTATION MARK
  });
  it("allows literal curly quotes that are not entities", () => {
    const LONG = "The doctor said “you are healing well” and it motivated me to push harder during the long recovery period after my hip surgery.";
    const html = `<p>${LONG}</p>`;
    expect(extractPhrase(html)).toBe(LONG);
  });
  it("preserves invalid numeric entities as literal text in the returned phrase", () => {
    const html = "<p>Recovery is complex&#99999999999999; and takes weeks or months to see meaningful progress after hip surgery or any major procedure.</p>";
    const phrase = extractPhrase(html);
    expect(phrase).toBeTruthy();
    expect(phrase).toContain("&#99999999999999;");
  });
  it("still rejects straight double quotes even with typographic entities present", () => {
    const quoted = 'The doctor said "you are healing well" and it motivated me during rehab.';
    const LONG = "Recovery isn’t linear and after hip surgery rehabilitation usually takes weeks or months to see meaningful progress.";
    expect(extractPhrase(`<p>${quoted}</p><p>Recovery isn&rsquo;t linear and after hip surgery rehabilitation usually takes weeks or months to see meaningful progress.</p>`)).toBe(LONG);
  });
});
