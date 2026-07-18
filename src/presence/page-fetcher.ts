export interface FetchedPage { status: number; html: string }

/** Narrow injectable slice of fetch — enough to get a status and a body. */
export type PageFetch = (url: string) => Promise<{ status: number; text(): Promise<string> }>;

/**
 * Browser-like headers for the liveness fetch. growsteady.me is fronted by
 * Vercel, which 403s an obvious bot fetch (no/`node` User-Agent, no Accept)
 * from a datacenter IP — exactly the cloud-routine egress. A bare fetch there
 * turns every page into a false PAGE_NOT_LIVE and collapses the whole probe to
 * INCONCLUSIVE. Present as a real browser so page-liveness reflects the site,
 * not the bot filter. (A normal residential IP is served 200 regardless, which
 * is why a hand-run probe never hit this.)
 */
export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const defaultFetch: PageFetch = (url) =>
  fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });

/** Never throws: a network failure is status 0 (classified PAGE_NOT_LIVE), not an abort. */
export async function fetchPage(url: string, fetchImpl: PageFetch = defaultFetch): Promise<FetchedPage> {
  try {
    const res = await fetchImpl(url);
    if (res.status !== 200) return { status: res.status, html: "" };
    return { status: 200, html: await res.text() };
  } catch {
    return { status: 0, html: "" };
  }
}

const MIN_LEN = 80;
const MAX_LEN = 200;

/**
 * Decode HTML entities in a string, including numeric and named entities.
 * Decodes in order: numeric → named (except amp) → amp (LAST to prevent double-decoding).
 */
function decodeEntities(s: string): string {
  // Decode decimal numeric entities: &#8217; → String.fromCodePoint(8217)
  let result = s.replace(/&#(\d+);/g, (match, code) => {
    try {
      return String.fromCodePoint(parseInt(code, 10));
    } catch {
      return match; // Leave invalid code points unchanged
    }
  });

  // Decode hex numeric entities: &#x2019; → String.fromCodePoint(0x2019)
  result = result.replace(/&#[xX]([0-9a-fA-F]+);/g, (match, hex) => {
    try {
      return String.fromCodePoint(parseInt(hex, 16));
    } catch {
      return match; // Leave invalid code points unchanged
    }
  });

  // Decode named entities (except amp, which is decoded last)
  const namedEntities: Record<string, string> = {
    quot: '"',
    lt: "<",
    gt: ">",
    nbsp: " ",
    rsquo: String.fromCodePoint(0x2019), // U+2019 = RIGHT SINGLE QUOTATION MARK
    lsquo: String.fromCodePoint(0x2018), // U+2018 = LEFT SINGLE QUOTATION MARK
    ldquo: String.fromCodePoint(0x201c), // U+201C = LEFT DOUBLE QUOTATION MARK
    rdquo: String.fromCodePoint(0x201d), // U+201D = RIGHT DOUBLE QUOTATION MARK
    mdash: "—",
    ndash: "–",
    hellip: "…"
  };

  for (const [name, char] of Object.entries(namedEntities)) {
    result = result.replace(new RegExp(`&${name};`, "g"), char);
  }

  // Decode &amp; LAST to prevent double-decoding (e.g., &amp;#39; → &#39;, not ')
  result = result.replace(/&amp;/g, "&");

  return result;
}

/**
 * Longest sentence within [80, 200] chars from the tag-stripped page text.
 * Deriving the phrase from LIVE html makes "is it actually published?" true by
 * construction. Sentences with embedded double-quotes are rejected because the
 * R3 query wraps the phrase in double quotes.
 */
export function extractPhrase(html: string): string | null {
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
  let best: string | null = null;
  for (const raw of text.split(/(?<=[.!?])\s+/)) {
    const s = raw.trim();
    if (s.length < MIN_LEN || s.length > MAX_LEN) continue;
    if (s.includes('"')) continue;
    if (!best || s.length > best.length) best = s;
  }
  return best;
}
