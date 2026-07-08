import type { Snapshot, SnapshotDiff } from "./snapshot.js";

function pct(x: number): string { return `${(x * 100).toFixed(0)}%`; }
function pts(x: number): string { return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)} pts`; }

export function renderReport(snap: Snapshot, diff?: SnapshotDiff): string {
  const lines: string[] = [];
  lines.push(`# Steady visibility snapshot — ${snap.takenAt}`, "");
  lines.push("## SEO (per target page)");
  lines.push("| page | impressions | clicks | position |", "|---|---|---|---|");
  for (const [url, m] of Object.entries(snap.seo)) {
    lines.push(`| ${url} | ${m.impressions} | ${m.clicks} | ${m.position.toFixed(1)} |`);
  }
  lines.push("", "## GEO visibility");
  lines.push(`- target citation rate: ${pct(snap.geo.targetScore.citationRate)} (mention ${pct(snap.geo.targetScore.mentionRate)})`);
  lines.push(`- control citation rate: ${pct(snap.geo.controlScore.citationRate)} (mention ${pct(snap.geo.controlScore.mentionRate)})`);
  if (diff) {
    lines.push("", "## Change vs baseline");
    lines.push(`- target citation ${pts(diff.targetCitationDelta)} (control ${pts(diff.controlCitationDelta)})`);
    for (const d of diff.seo) {
      lines.push(`- ${d.pageUrl}: impressions ${d.impressions >= 0 ? "+" : ""}${d.impressions}, position ${d.position.toFixed(1)}`);
    }
  }
  return lines.join("\n");
}
