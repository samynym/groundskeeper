/** One raw painBand point from a Steady curve. */
export interface PainBandPoint {
  week: number;
  low: number;
  typical: number;
  high: number;
  basis: string;
  sourceUrl: string;
  [key: string]: unknown;
}

/** Flattened single-band entry expected by EvidenceRetriever.loadCurvePoints. */
export interface CurvePoint {
  week: number;
  band: "low" | "typical" | "high";
  value: number;
  basis: string;
  sourceUrl: string;
}

/** A curve object with at least a painBand array (plus optional slug). */
export interface CurveWithPainBand {
  slug?: string;
  painBand: PainBandPoint[];
}

/**
 * Expand a real Steady curve's painBand into the flat CurvePoint array
 * expected by EvidenceRetriever. Each source point yields THREE entries —
 * one per band. Points with empty sourceUrl are kept (the retriever filters
 * them out via its own closed-world rule).
 */
export function expandPainBand(curve: CurveWithPainBand): CurvePoint[] {
  const result: CurvePoint[] = [];
  for (const pt of curve.painBand) {
    const { week, low, typical, high, basis, sourceUrl } = pt;
    result.push({ week, band: "low",     value: low,     basis, sourceUrl });
    result.push({ week, band: "typical", value: typical, basis, sourceUrl });
    result.push({ week, band: "high",    value: high,    basis, sourceUrl });
  }
  return result;
}
