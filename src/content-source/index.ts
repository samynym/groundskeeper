import type { Basis, EditOp, PageRef, Source } from "../types.js";

export interface ReadContent {
  prose: Record<string, string>;
  sources: Source[];
}

export interface ContentSource {
  /** All public pages (pillars + week pages). */
  listPages(): Promise<PageRef[]>;
  /** Prose fields + sources for a procedure. */
  readContent(ref: PageRef): Promise<ReadContent>;
  /** Current basis of a curve band, or null if that point doesn't exist. */
  currentBasis(procedureSlug: string, week: number, band: "low" | "typical" | "high"): Promise<Basis | null>;
  /** Epoch ms of the last git commit touching this procedure's files. */
  lastEditedAt(procedureSlug: string): Promise<number>;
  /** Apply structured edits to the working tree (no commit). */
  applyOps(ops: EditOp[]): Promise<void>;
}
