import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SeoMetrics } from "./seo-snapshot.js";
import type { GeoSnapshot } from "./geo-tracker.js";

export interface Snapshot {
  takenAt: string;
  seo: Record<string, SeoMetrics>;
  geo: GeoSnapshot;
}

export interface SeoDelta {
  pageUrl: string;
  impressions: number; // after - before
  clicks: number;
  position: number;    // after - before; negative = improved (moved up the results)
}

export interface SnapshotDiff {
  seo: SeoDelta[];
  targetCitationDelta: number;
  targetMentionDelta: number;
  controlCitationDelta: number;
  controlMentionDelta: number;
}

export function writeSnapshot(dir: string, snap: Snapshot): string {
  mkdirSync(dir, { recursive: true });
  const safe = snap.takenAt.replace(/[:.]/g, "-");
  const path = join(dir, `${safe}.json`);
  writeFileSync(path, JSON.stringify(snap, null, 2));
  return path;
}

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const seo: SeoDelta[] = [];
  for (const pageUrl of Object.keys(after.seo)) {
    const b = before.seo[pageUrl];
    const a = after.seo[pageUrl];
    if (!b || !a) continue;
    seo.push({
      pageUrl,
      impressions: a.impressions - b.impressions,
      clicks: a.clicks - b.clicks,
      position: a.position - b.position,
    });
  }
  return {
    seo,
    targetCitationDelta: after.geo.targetScore.citationRate - before.geo.targetScore.citationRate,
    targetMentionDelta: after.geo.targetScore.mentionRate - before.geo.targetScore.mentionRate,
    controlCitationDelta: after.geo.controlScore.citationRate - before.geo.controlScore.citationRate,
    controlMentionDelta: after.geo.controlScore.mentionRate - before.geo.controlScore.mentionRate,
  };
}
