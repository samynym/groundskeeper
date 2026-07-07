import type { GscRow } from "../types.js";
import type { TargetSet } from "./targets.js";

export interface SeoMetrics {
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

export async function snapshotSeo(
  targets: TargetSet,
  perf: { snapshot(): Promise<Record<string, GscRow>> },
): Promise<Record<string, SeoMetrics>> {
  const gsc = await perf.snapshot();
  const out: Record<string, SeoMetrics> = {};
  for (const item of targets.items) {
    const row = gsc[item.pageUrl];
    out[item.pageUrl] = row
      ? { impressions: row.impressions, clicks: row.clicks, ctr: row.ctr, position: row.position }
      : { impressions: 0, clicks: 0, ctr: 0, position: 0 };
  }
  return out;
}
