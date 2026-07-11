export interface FetchedPage { status: number; html: string }

/** Narrow injectable slice of fetch — enough to get a status and a body. */
export type PageFetch = (url: string) => Promise<{ status: number; text(): Promise<string> }>;

const defaultFetch: PageFetch = (url) => fetch(url);

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
