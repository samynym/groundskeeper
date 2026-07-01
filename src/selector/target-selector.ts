import type { Candidate, GscRow, PageRef } from "../types.js";

export interface SelectorDeps {
  interpolatedCount(ref: PageRef): Promise<number>;
  sourceCount(ref: PageRef): Promise<number>;
  lastEditedAt(procedureSlug: string): Promise<number>;
}

const DAY = 864e5;

export class TargetSelector {
  constructor(private deps: SelectorDeps) {}

  async rank(pages: PageRef[], gscByUrl: Record<string, GscRow>, now: number): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    for (const ref of pages) {
      const gsc = gscByUrl[ref.url];
      const reasons: string[] = [];
      let score = 0;

      if (gsc) {
        if (gsc.position >= 11 && gsc.position <= 30) { score += 3; reasons.push(`page-2/3 position ${gsc.position.toFixed(1)}`); }
        if (gsc.impressions >= 100 && gsc.ctr < 0.02) { score += 2; reasons.push(`low CTR ${(gsc.ctr * 100).toFixed(1)}% on ${gsc.impressions} impressions`); }
      }
      const interp = await this.deps.interpolatedCount(ref);
      if (interp > 0) { score += Math.min(interp, 5) * 0.6; reasons.push(`${interp} interpolated band(s)`); }
      const sources = await this.deps.sourceCount(ref);
      if (sources <= 2) { score += 1.5; reasons.push(`thin sources (${sources})`); }
      const edited = await this.deps.lastEditedAt(ref.procedureSlug);
      if (edited > 0) {
        const age = (now - edited) / DAY;
        if (age > 90) { score += Math.min((age - 90) / 90, 2); reasons.push(`${Math.round(age)}d since last edit`); }
      }

      candidates.push({ ref, score, reasons, gsc });
    }
    return candidates.sort((a, b) => b.score - a.score);
  }

  pickOne(candidates: Candidate[]): Candidate | null {
    return candidates.length && candidates[0].score > 0 ? candidates[0] : null;
  }
}
