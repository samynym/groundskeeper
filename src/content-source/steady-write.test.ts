import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SteadyContentSource } from "./steady.js";

const fixtureRoot = resolve(__dirname, "../../test/fixtures/steady-mini");

function freshCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "gk-"));
  cpSync(fixtureRoot, dir, { recursive: true });
  return dir;
}

describe("SteadyContentSource applyOps", () => {
  let repo: string;
  let cs: SteadyContentSource;
  beforeEach(() => {
    repo = freshCopy();
    cs = new SteadyContentSource({
      repoPath: repo,
      loadModule: (rel) => import(pathToFileURL(join(repo, rel)).href + `?t=${Date.now()}`),
    });
  });

  it("replaceProse on heroIntro.0 edits that element", async () => {
    await cs.applyOps([{
      type: "replaceProse",
      procedureSlug: "hip-arthroscopy-fai",
      field: "heroIntro.0",
      oldText: "Recovery after hip arthroscopy for FAI is gradual.",
      newText: "Recovery is gradual and measured in weeks.",
      claims: [],
    }]);
    const src = readFileSync(join(repo, "lib/benchmarks/content/hip-arthroscopy-fai.ts"), "utf8");
    expect(src).toContain("measured in weeks");
    expect(src).not.toContain("FAI is gradual.");
  });

  it("replaceProse on phase.early-recovery.body.1 edits that line", async () => {
    await cs.applyOps([{
      type: "replaceProse",
      procedureSlug: "hip-arthroscopy-fai",
      field: "phase.early-recovery.body.1",
      oldText: "Crutches are typical for the first two to four weeks.",
      newText: "Crutches are needed for two to six weeks in more complex cases.",
      claims: [],
    }]);
    const src = readFileSync(join(repo, "lib/benchmarks/content/hip-arthroscopy-fai.ts"), "utf8");
    expect(src).toContain("two to six weeks");
    // old body text should be gone (the faq also has "two to four weeks" but not the exact original phrase)
    expect(src).not.toContain("Crutches are typical for the first two to four weeks.");
  });

  it("addSource appends to the curve's sources array (not content file)", async () => {
    await cs.applyOps([{
      type: "addSource",
      procedureSlug: "hip-arthroscopy-fai",
      source: { title: "Memon RTP meta 2019", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8530429/", tier: "meta-analysis", reliabilityScore: 8.0 },
    }]);
    const curveSrc = readFileSync(join(repo, "lib/benchmarks/curves/index.ts"), "utf8");
    expect(curveSrc).toContain("PMC8530429");
  });

  it("promoteToMeasured week 6 — sets measured, leaves week 12 untouched (exact-week-match)", async () => {
    await cs.applyOps([{
      type: "promoteToMeasured",
      procedureSlug: "hip-arthroscopy-fai",
      week: 6,
      band: "typical",
      value: 3.5,
      sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/",
      nativeScale: "0-10",
    }]);
    const src = readFileSync(join(repo, "lib/benchmarks/curves/index.ts"), "utf8");
    // week 6 typical should be updated, basis → "measured"
    expect(src).toMatch(/week: 6[^}]*typical: 3\.5/s);
    expect(src).toMatch(/week: 6[^}]*basis: "measured"/s);
    // week 12 must remain interpolated (proves exact-match didn't catch week 12 as substring of 12)
    expect(src).toMatch(/week: 12[^}]*basis: "interpolated"/s);
  });

  it("replaceProse on unknown field throws", async () => {
    await expect(cs.applyOps([{
      type: "replaceProse",
      procedureSlug: "hip-arthroscopy-fai",
      field: "bogusField.0",
      oldText: "x",
      newText: "y",
      claims: [],
    }])).rejects.toThrow(/unknown replaceProse field/);
  });

  it("promoteToMeasured week 6 — leaves adjacent bands (low, high) untouched", async () => {
    await cs.applyOps([{
      type: "promoteToMeasured",
      procedureSlug: "hip-arthroscopy-fai",
      week: 6,
      band: "typical",
      value: 3.5,
      sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/",
      nativeScale: "0-10",
    }]);
    const src = readFileSync(join(repo, "lib/benchmarks/curves/index.ts"), "utf8");
    // low and high at week 6 must remain at fixture values (2 and 4)
    expect(src).toMatch(/week: 6[^}]*low: 2\b/s);
    expect(src).toMatch(/week: 6[^}]*high: 4\b/s);
  });
});
