export type Basis = "measured" | "interpolated";

export interface Source {
  title: string;
  url: string;
  tier: string;
  reliabilityScore: number;
}

export interface PageRef {
  procedureSlug: string; // internal, e.g. "hip-arthroscopy-fai"
  urlSlug: string;       // public, e.g. "hip-arthroscopy-recovery-timeline"
  week: number | null;   // null = pillar page
  url: string;           // full public URL
}

export interface GscRow {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;      // 0..1
  position: number; // 1 = top
}

export interface Candidate {
  ref: PageRef;
  score: number;
  reasons: string[];
  gsc?: GscRow;
}

/** A single assertion the drafter makes, plus the source it claims backs it. */
export interface ClaimRef {
  text: string;
  sourceUrl: string;
}

export type EditOp =
  | { type: "replaceProse"; procedureSlug: string; field: string; oldText: string; newText: string; claims: ClaimRef[] }
  | { type: "addSource"; procedureSlug: string; source: Source }
  | { type: "updateMeta"; procedureSlug: string; week: number | null; field: "title" | "description"; value: string; claims: ClaimRef[] }
  | { type: "promoteToMeasured"; procedureSlug: string; week: number; band: "low" | "typical" | "high"; value: number; sourceUrl: string; nativeScale: string };

export interface Draft {
  ref: PageRef;
  ops: EditOp[];
  rationale: string;
}

/** Everything the agent is allowed to cite for one target. */
export interface EvidenceItem {
  claimText: string;   // a fact stated in the base/dossier
  sourceUrl: string;
  sourceTitle: string;
  numbers: number[];   // numeric tokens present in claimText (for mechanical checks)
  // Structured provenance — present for curve-derived facts, undefined for free-text
  // dossier facts. A promoteToMeasured may only cite a fact whose basis is "measured".
  week?: number;
  band?: "low" | "typical" | "high";
  value?: number;
  basis?: Basis;
}

export interface EvidenceSet {
  ref: PageRef;
  sources: Source[];                                  // known sources for this procedure
  knownSourceUrls: Set<string>;                       // sources[] ∪ dossier URLs
  facts: EvidenceItem[];                              // from curve points + dossier
}

export interface GuardVerdict {
  op: EditOp;
  ok: boolean;
  failures: string[]; // human-readable reasons, empty when ok
}

export interface GuardResult {
  verdicts: GuardVerdict[];
  passedOps: EditOp[];
  allPassed: boolean;
}

/** Claims carried by an op (for guard iteration). promoteToMeasured/addSource carry an implicit claim. */
export function claimsOf(op: EditOp): ClaimRef[] {
  switch (op.type) {
    case "replaceProse": return op.claims;
    case "updateMeta": return op.claims;
    case "addSource": return [{ text: op.source.title, sourceUrl: op.source.url }];
    case "promoteToMeasured": return [{ text: `${op.band}=${op.value}`, sourceUrl: op.sourceUrl }];
  }
}
