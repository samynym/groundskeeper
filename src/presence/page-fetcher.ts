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
 * Longest sentence within [80, 200] chars from the tag-stripped page text.
 * Deriving the phrase from LIVE html makes "is it actually published?" true by
 * construction. Sentences with embedded double-quotes are rejected because the
 * R3 query wraps the phrase in double quotes.
 */
export function extractPhrase(html: string): string | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
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
