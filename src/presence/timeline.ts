import type { PresenceExperiment } from "./experiments.js";
import type { PresenceSnapshot } from "./snapshot.js";

type Event =
  | { at: string; kind: "snapshot"; snap: PresenceSnapshot }
  | { at: string; kind: "experiment"; exp: PresenceExperiment };

/**
 * One chronological axis for interventions and verdict changes. After a
 * domain-scoped experiment, every later snapshot carries the attribution
 * warning — the spec's "limitation as rendered artifact, not footnote".
 */
export function renderTimeline(snapshots: PresenceSnapshot[], experiments: PresenceExperiment[]): string {
  const events: Event[] = [
    ...snapshots.map((s) => ({ at: s.takenAt, kind: "snapshot" as const, snap: s })),
    ...experiments.map((e) => ({ at: e.at, kind: "experiment" as const, exp: e })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const lines: string[] = ["# Presence timeline", ""];
  if (events.length === 0) {
    lines.push("(no snapshots or experiments recorded)");
    return lines.join("\n");
  }

  let domainInterventionSeen = false;
  for (const ev of events) {
    if (ev.kind === "experiment") {
      const e = ev.exp;
      lines.push(`- ${e.at} · experiment **${e.name}** (${e.kind}, ${e.scope}) → ${e.outcome}${e.notes ? ` — ${e.notes}` : ""}`);
      if (e.scope === "domain") {
        domainInterventionSeen = true;
        lines.push("  ⚠ domain-scoped intervention: control pages are lifted too — presence effects after this point cannot be attributed against controls");
      }
    } else {
      const s = ev.snap;
      lines.push(`- ${s.takenAt} · snapshot${domainInterventionSeen ? " ⚠ (post-domain-intervention window)" : ""}`);
      for (const v of s.verdicts) {
        const per = v.perEngine.map((p) => `${p.engine}: ${p.verdict}`).join(", ");
        lines.push(`  - ${v.pageUrl}${v.control ? " [control]" : ""} → **${v.best}**${per ? ` (${per})` : ""}`);
      }
    }
  }
  return lines.join("\n");
}
