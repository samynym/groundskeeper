import { describe, it, expect } from "vitest";
import { EvidenceRetriever, parseScaleBounds } from "./retriever.js";
import type { PageRef } from "../types.js";

describe("parseScaleBounds", () => {
  it("parses a leading range", () => {
    expect(parseScaleBounds("VAS/NRS 0-10 acute post-op")).toEqual([0, 10]);
    expect(parseScaleBounds("scored 0 to 100 on the KOOS")).toEqual([0, 100]);
  });
  it("returns null when there is no clean range (never fabricates a scale)", () => {
    expect(parseScaleBounds(undefined)).toBeNull();
    expect(parseScaleBounds("a qualitative descriptor")).toBeNull();
    expect(parseScaleBounds("measured at 6 hours")).toBeNull();
  });
});

const ref: PageRef = { procedureSlug: "hip-arthroscopy-fai", urlSlug: "u", week: null, url: "x" };

const retriever = new EvidenceRetriever({
  readContent: async () => ({ prose: {}, sources: [{ title: "Cunningham 2017", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/", tier: "cohort", reliabilityScore: 7.5 }] }),
  loadCurvePoints: async () => [{ week: 0, band: "typical", value: 5.2, basis: "measured", sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/", nativeScale: "VAS/NRS 0-10 acute post-op" }],
  readDossier: async () => "Memon RTP meta finds 87% return to sport https://pmc.ncbi.nlm.nih.gov/articles/PMC8530429/",
});

describe("EvidenceRetriever", () => {
  it("unions source URLs from sources[] and dossier", async () => {
    const ev = await retriever.retrieve(ref);
    expect(ev.knownSourceUrls.has("https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/")).toBe(true);
    expect(ev.knownSourceUrls.has("https://pmc.ncbi.nlm.nih.gov/articles/PMC8530429/")).toBe(true);
  });
  it("extracts numbers from facts", async () => {
    const ev = await retriever.retrieve(ref);
    const dossierFact = ev.facts.find((f) => f.claimText.includes("return to sport"));
    expect(dossierFact?.numbers).toContain(87);
  });
  it("carries structured week/band/value/basis on curve facts (for promote grounding)", async () => {
    const ev = await retriever.retrieve(ref);
    const curveFact = ev.facts.find((f) => f.sourceUrl === "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/");
    expect(curveFact).toMatchObject({ week: 0, band: "typical", value: 5.2, basis: "measured" });
  });
  it("folds the pain scale bounds into the fact so '/10' phrasing is grounded", async () => {
    const ev = await retriever.retrieve(ref);
    const curveFact = ev.facts.find((f) => f.sourceUrl === "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/");
    expect(curveFact?.claimText).toMatch(/0-10 pain scale/);
    expect(curveFact?.numbers).toContain(10); // the upper bound is now a backed number
  });
  it("leaves structured fields undefined on free-text dossier facts", async () => {
    const ev = await retriever.retrieve(ref);
    const dossierFact = ev.facts.find((f) => f.claimText.includes("return to sport"));
    expect(dossierFact?.basis).toBeUndefined();
    expect(dossierFact?.week).toBeUndefined();
  });
});
