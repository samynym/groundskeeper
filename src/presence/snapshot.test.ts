import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePresenceSnapshot, readPresenceSnapshot, diffPresence, type PresenceSnapshot } from "./snapshot.js";
import type { PageVerdict } from "./classify.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gk-psnap-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const pv = (pageUrl: string, best: PageVerdict["best"]): PageVerdict =>
  ({ pageUrl, procedureSlug: "s", control: false, perEngine: [{ engine: "e", verdict: best, reasons: [] }], best });

const snap = (takenAt: string, verdicts: PageVerdict[]): PresenceSnapshot => ({ takenAt, verdicts, raw: [] });

describe("write/read round-trip", () => {
  it("persists under a filesystem-safe timestamp name and reads back identically", () => {
    const s = snap("2026-07-10T10:00:00.000Z", [pv("https://g.me/a", "ABSENT")]);
    const path = writePresenceSnapshot(dir, s);
    expect(path).toBe(join(dir, "2026-07-10T10-00-00-000Z.json"));
    expect(readPresenceSnapshot(path)).toEqual(s);
  });
});

describe("diffPresence", () => {
  it("reports per-page verdict transitions, including pages present on one side only", () => {
    const before = snap("t1", [pv("https://g.me/a", "ABSENT"), pv("https://g.me/gone", "ABSENT")]);
    const after = snap("t2", [pv("https://g.me/a", "CITED"), pv("https://g.me/new", "ABSENT")]);
    const d = diffPresence(before, after);
    expect(d.find((t) => t.pageUrl === "https://g.me/a")).toEqual(
      { pageUrl: "https://g.me/a", before: "ABSENT", after: "CITED", changed: true });
    expect(d.find((t) => t.pageUrl === "https://g.me/gone")).toEqual(
      { pageUrl: "https://g.me/gone", before: "ABSENT", after: null, changed: true });
    expect(d.find((t) => t.pageUrl === "https://g.me/new")).toEqual(
      { pageUrl: "https://g.me/new", before: null, after: "ABSENT", changed: true });
  });
});
