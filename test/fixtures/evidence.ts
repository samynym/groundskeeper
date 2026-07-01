import type { EditOp, EvidenceSet, PageRef } from "../../src/types.js";

const ref: PageRef = { procedureSlug: "hip-arthroscopy-fai", urlSlug: "hip-arthroscopy-recovery-timeline", week: null, url: "https://growsteady.me/hip-arthroscopy-recovery-timeline" };

const KNOWN_A = "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/";
const KNOWN_B = "https://pmc.ncbi.nlm.nih.gov/articles/PMC8530429/";
export const KNOWN_C = "https://pmc.ncbi.nlm.nih.gov/articles/PMC9999999/";

export const goldenEvidence: EvidenceSet = {
  ref,
  sources: [{ title: "Cunningham 2017", url: KNOWN_A, tier: "cohort", reliabilityScore: 7.5 }],
  knownSourceUrls: new Set([KNOWN_A, KNOWN_B, KNOWN_C]),
  facts: [
    { claimText: "week 0 typical = 5.2", sourceUrl: KNOWN_A, sourceTitle: "Cunningham 2017", numbers: [0, 5.2] },
    { claimText: "87% return to sport by 12 months", sourceUrl: KNOWN_B, sourceTitle: "Memon 2019", numbers: [87, 12] },
  ],
};

export const groundedOps: EditOp[] = [
  // claim cites a known URL, and its number (87) exists in a fact
  { type: "replaceProse", procedureSlug: ref.procedureSlug, field: "outlook", oldText: "Most return within a year.", newText: "About 87% of patients return to sport by 12 months.", claims: [{ text: "87% return to sport by 12 months", sourceUrl: KNOWN_B }] },
  // adding a source that exists in the dossier/known set
  { type: "addSource", procedureSlug: ref.procedureSlug, source: { title: "Memon 2019", url: KNOWN_B, tier: "meta-analysis", reliabilityScore: 8.0 } },
  // promote: sourceUrl is known, value 5.2 is backed by KNOWN_A's fact, and basis is stubbed "interpolated" → passes
  { type: "promoteToMeasured", procedureSlug: ref.procedureSlug, week: 0, band: "typical", value: 5.2, sourceUrl: KNOWN_A, nativeScale: "0-10 scale" },
];

export const fabricatedOps: EditOp[] = [
  // why: cites a URL not in knownSourceUrls (invented source)
  { type: "replaceProse", procedureSlug: ref.procedureSlug, field: "outlook", oldText: "x", newText: "95% return in 8 weeks.", claims: [{ text: "95% return in 8 weeks", sourceUrl: "https://example.com/made-up" }] },
  // why: number 95 in prose is not present in any fact for the cited (known) source
  { type: "replaceProse", procedureSlug: ref.procedureSlug, field: "outlook", oldText: "x", newText: "95% return to sport by 12 months.", claims: [{ text: "95% return to sport by 12 months", sourceUrl: KNOWN_B }] },
  // why: addSource with an invented URL
  { type: "addSource", procedureSlug: ref.procedureSlug, source: { title: "Fake study", url: "https://example.com/nope", tier: "cohort", reliabilityScore: 9 } },
  // why: promote cites a sourceUrl not in knownSourceUrls
  { type: "promoteToMeasured", procedureSlug: ref.procedureSlug, week: 0, band: "typical", value: 5.2, sourceUrl: "https://example.com/made-up", nativeScale: "x" },
  // why: promote value 99 is not present in KNOWN_A's facts
  { type: "promoteToMeasured", procedureSlug: ref.procedureSlug, week: 0, band: "typical", value: 99, sourceUrl: KNOWN_A, nativeScale: "x" },
];
