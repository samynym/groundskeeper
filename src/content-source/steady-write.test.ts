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

  it("replaceProse edits the prose field in source", async () => {
    await cs.applyOps([{ type: "replaceProse", procedureSlug: "hip-arthroscopy-fai", field: "intro", oldText: "Recovery after hip arthroscopy for FAI is gradual.", newText: "Recovery is gradual and measured in weeks.", claims: [] }]);
    const src = readFileSync(join(repo, "lib/benchmarks/content/hip.ts"), "utf8");
    expect(src).toContain("measured in weeks");
    expect(src).not.toContain("FAI is gradual.");
  });

  it("addSource appends to the sources array", async () => {
    await cs.applyOps([{ type: "addSource", procedureSlug: "hip-arthroscopy-fai", source: { title: "Memon RTP meta 2019", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8530429/", tier: "meta-analysis", reliabilityScore: 8.0 } }]);
    const src = readFileSync(join(repo, "lib/benchmarks/content/hip.ts"), "utf8");
    expect(src).toContain("PMC8530429");
  });

  it("promoteToMeasured mutates exact week-1 and leaves week-12 unchanged", async () => {
    await cs.applyOps([{ type: "promoteToMeasured", procedureSlug: "hip-arthroscopy-fai", week: 1, band: "typical", value: 4.4, sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/", nativeScale: "x" }]);
    const src = readFileSync(join(repo, "lib/benchmarks/curves/hip.ts"), "utf8");
    // week-1 point should be mutated to 4.4 / "measured"
    expect(src).toMatch(/week: 1\b[^}]*value: 4\.4[^}]*basis: "measured"/s);
    // week-12 should remain 2.0 / "interpolated" (substring bug would have mutated this instead)
    expect(src).toMatch(/week: 12\b[^}]*value: 2[^}]*basis: "interpolated"/s);
  });
});
