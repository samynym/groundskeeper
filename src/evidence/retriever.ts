import type { Basis, EvidenceItem, EvidenceSet, PageRef, Source } from "../types.js";
import type { ReadContent } from "../content-source/index.js";

const URL_RE = /https?:\/\/[^\s)]+/g;

export function extractNumbers(text: string): number[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/**
 * Pull the leading numeric range (e.g. "0-10") out of a freeform nativeScale string like
 * "VAS/NRS 0-10 acute post-op; ...". Returns null if no clean range is present. Only the
 * scale bounds are trusted — the rest of the freeform text is deliberately NOT ingested.
 */
export function parseScaleBounds(nativeScale: string | undefined): [number, number] | null {
  if (!nativeScale) return null;
  const m = nativeScale.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  return [lo, hi];
}

export interface RetrieverDeps {
  readContent(ref: PageRef): Promise<ReadContent>;
  loadCurvePoints(procedureSlug: string): Promise<Array<{ sourceUrl: string; value: number; band: string; week: number; basis: string; nativeScale?: string }>>;
  readDossier(procedureSlug: string): Promise<string>;
}

export class EvidenceRetriever {
  constructor(private deps: RetrieverDeps) {}

  async retrieve(ref: PageRef): Promise<EvidenceSet> {
    const { sources } = await this.deps.readContent(ref);
    const points = await this.deps.loadCurvePoints(ref.procedureSlug);
    const dossier = await this.deps.readDossier(ref.procedureSlug);

    const known = new Set<string>();
    for (const s of sources) known.add(s.url);
    for (const url of dossier.match(URL_RE) ?? []) known.add(url);
    for (const p of points) if (p.sourceUrl) known.add(p.sourceUrl);

    const facts: EvidenceItem[] = [];
    for (const p of points) {
      if (!p.sourceUrl) continue;
      const title = sources.find((s) => s.url === p.sourceUrl)?.title ?? p.sourceUrl;
      // Fold the scale bounds into the fact so "5.2 out of 10"-style phrasing is grounded
      // (the number 10 is otherwise absent and the mechanical gate would reject it).
      const scale = parseScaleBounds(p.nativeScale);
      const claimText = scale
        ? `week ${p.week} ${p.band} = ${p.value} on a ${scale[0]}-${scale[1]} pain scale`
        : `week ${p.week} ${p.band} = ${p.value}`;
      facts.push({
        claimText, sourceUrl: p.sourceUrl, sourceTitle: title, numbers: extractNumbers(claimText),
        week: p.week, band: p.band as "low" | "typical" | "high", value: p.value, basis: p.basis as Basis,
      });
    }
    for (const line of dossier.split(/\n+/)) {
      const url = line.match(URL_RE)?.[0];
      if (!url) continue;
      facts.push({ claimText: line.trim(), sourceUrl: url, sourceTitle: url, numbers: extractNumbers(line) });
    }
    return { ref, sources: sources as Source[], knownSourceUrls: known, facts };
  }
}
