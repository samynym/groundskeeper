import { describe, it, expect } from "vitest";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { SteadyContentSource } from "./steady.js";

const fixtureRoot = resolve(__dirname, "../../test/fixtures/steady-mini");
const loadModule = (rel: string) => import(pathToFileURL(join(fixtureRoot, rel)).href);

describe("SteadyContentSource read", () => {
  const cs = new SteadyContentSource({ repoPath: fixtureRoot, loadModule });

  it("lists the pillar page from curves index", async () => {
    const pages = await cs.listPages();
    expect(pages.some((p) => p.urlSlug === "hip-arthroscopy-recovery-timeline" && p.week === null)).toBe(true);
  });

  it("listPages emits absolute URL when targetOrigin is set", async () => {
    const csWithOrigin = new SteadyContentSource({ repoPath: fixtureRoot, loadModule, targetOrigin: "https://growsteady.me" });
    const pages = await csWithOrigin.listPages();
    expect(pages.some((p) => p.url === "https://growsteady.me/hip-arthroscopy-recovery-timeline")).toBe(true);
  });

  it("readContent flattens prose using dot-path keys", async () => {
    const ref = { procedureSlug: "hip-arthroscopy-fai", urlSlug: "hip-arthroscopy-recovery-timeline", week: null as null, url: "x" };
    const c = await cs.readContent(ref);
    expect(c.prose["metaTitle"]).toBe("Hip arthroscopy recovery timeline, week by week");
    expect(c.prose["heroIntro.0"]).toMatch(/gradual/);
    expect(c.prose["heroIntro.1"]).toMatch(/year/);
    expect(c.prose["phase.early-recovery.body.1"]).toMatch(/Crutches/);
    expect(c.prose["faq.0.q"]).toMatch(/crutches/i);
  });

  it("readContent sources come from the curve (not content object)", async () => {
    const ref = { procedureSlug: "hip-arthroscopy-fai", urlSlug: "hip-arthroscopy-recovery-timeline", week: null as null, url: "x" };
    const c = await cs.readContent(ref);
    expect(c.sources.length).toBeGreaterThan(0);
    expect(c.sources[0].url).toContain("PMC5721367");
  });

  it("currentBasis returns week-level basis (band param ignored)", async () => {
    expect(await cs.currentBasis("hip-arthroscopy-fai", 0, "typical")).toBe("measured");
    expect(await cs.currentBasis("hip-arthroscopy-fai", 6, "typical")).toBe("interpolated");
    expect(await cs.currentBasis("hip-arthroscopy-fai", 6, "low")).toBe("interpolated");
    expect(await cs.currentBasis("hip-arthroscopy-fai", 99, "typical")).toBeNull();
  });

  it("interpolatedCount returns count of interpolated painBand points", async () => {
    expect(await cs.interpolatedCount("hip-arthroscopy-fai")).toBe(2);
    expect(await cs.interpolatedCount("unknown-procedure")).toBe(0);
  });
});
