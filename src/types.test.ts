import { describe, it, expect } from "vitest";
import type { EditOp, PageRef } from "./types.js";
import { isReplaceProse } from "./types.js";

describe("types", () => {
  it("narrows EditOp by discriminant", () => {
    const ref: PageRef = { procedureSlug: "hip-arthroscopy-fai", urlSlug: "hip-arthroscopy-recovery-timeline", week: null, url: "https://x/y" };
    const op: EditOp = { type: "replaceProse", procedureSlug: ref.procedureSlug, field: "intro", oldText: "a", newText: "b", claims: [] };
    expect(isReplaceProse(op)).toBe(true);
  });
});
