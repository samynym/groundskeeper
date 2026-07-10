import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PageVerdict, Verdict } from "./classify.js";
import type { RungResult } from "./prober.js";

/** raw keeps every GeoAnswer for audit — same discipline as GeoSnapshot. */
export interface PresenceSnapshot {
  takenAt: string;
  verdicts: PageVerdict[];
  raw: RungResult[];
}

export function writePresenceSnapshot(dir: string, snap: PresenceSnapshot): string {
  mkdirSync(dir, { recursive: true });
  const safe = snap.takenAt.replace(/[:.]/g, "-");
  const path = join(dir, `${safe}.json`);
  writeFileSync(path, JSON.stringify(snap, null, 2));
  return path;
}

export function readPresenceSnapshot(path: string): PresenceSnapshot {
  return JSON.parse(readFileSync(path, "utf8")) as PresenceSnapshot;
}

export interface VerdictTransition {
  pageUrl: string;
  before: Verdict | null;
  after: Verdict | null;
  changed: boolean;
}

export function diffPresence(before: PresenceSnapshot, after: PresenceSnapshot): VerdictTransition[] {
  const pages = [...new Set([...before.verdicts.map((v) => v.pageUrl), ...after.verdicts.map((v) => v.pageUrl)])];
  return pages.map((pageUrl) => {
    const b = before.verdicts.find((v) => v.pageUrl === pageUrl)?.best ?? null;
    const a = after.verdicts.find((v) => v.pageUrl === pageUrl)?.best ?? null;
    return { pageUrl, before: b, after: a, changed: b !== a };
  });
}
