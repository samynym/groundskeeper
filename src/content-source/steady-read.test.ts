import { describe, it, expect } from "vitest";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { SteadyContentSource } from "./steady.js";

const fixtureRoot = resolve(__dirname, "../../test/fixtures/steady-mini");
const loadModule = (rel: string) => import(pathToFileURL(join(fixtureRoot, rel)).href);

describe("SteadyContentSource read", () => {
  const cs = new SteadyContentSource({ repoPath: fixtureRoot, loadModule });

  it("lists the pillar page", async () => {
    const pages = await cs.listPages();
    expect(pages.some((p) => p.urlSlug === "hip-arthroscopy-recovery-timeline" && p.week === null)).toBe(true);
  });
  it("reads prose + sources", async () => {
    const c = await cs.readContent({ procedureSlug: "hip-arthroscopy-fai", urlSlug: "hip-arthroscopy-recovery-timeline", week: null, url: "x" });
    expect(c.prose.intro).toMatch(/gradual/);
    expect(c.sources[0].url).toContain("PMC5721367");
  });
  it("returns the basis of a curve band", async () => {
    expect(await cs.currentBasis("hip-arthroscopy-fai", 6, "typical")).toBe("interpolated");
    expect(await cs.currentBasis("hip-arthroscopy-fai", 99, "typical")).toBeNull();
  });
});
