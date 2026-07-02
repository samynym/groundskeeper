import type { Basis, EvidenceItem, EvidenceSet, PageRef, Source } from "../types.js";
import type { ReadContent } from "../content-source/index.js";

const URL_RE = /https?:\/\/[^\s)]+/g;

export function extractNumbers(text: string): number[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

export interface RetrieverDeps {
  readContent(ref: PageRef): Promise<ReadContent>;
  loadCurvePoints(procedureSlug: string): Promise<Array<{ sourceUrl: string; value: number; band: string; week: number; basis: string }>>;
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
      const claimText = `week ${p.week} ${p.band} = ${p.value}`;
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
