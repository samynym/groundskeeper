import { describe, it, expect } from "vitest";
import { RefreshDrafter } from "./refresh-drafter.js";
import { FakeLlm } from "../llm/client.js";
import { goldenEvidence } from "../../test/fixtures/evidence.js";

const candidate = { ref: goldenEvidence.ref, score: 5, reasons: ["page-2 position"] };
const content = { prose: { outlook: "Most return within a year." }, sources: goldenEvidence.sources };

describe("RefreshDrafter", () => {
  it("parses valid ops and keeps grounded ones", async () => {
    const reply = JSON.stringify({ rationale: "tighten outlook", ops: [
      { type: "replaceProse", procedureSlug: "hip-arthroscopy-fai", field: "outlook", oldText: "Most return within a year.", newText: "About 87% return to sport by 12 months.", claims: [{ text: "87% return to sport by 12 months", sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8530429/" }] },
    ] });
    const drafter = new RefreshDrafter(new FakeLlm([reply]));
    const d = await drafter.draft(candidate, content, goldenEvidence);
    expect(d.ops).toHaveLength(1);
  });
  it("drops ops citing unknown sources", async () => {
    const reply = JSON.stringify({ rationale: "x", ops: [
      { type: "addSource", procedureSlug: "hip-arthroscopy-fai", source: { title: "Fake", url: "https://example.com/nope", tier: "cohort", reliabilityScore: 9 } },
    ] });
    const drafter = new RefreshDrafter(new FakeLlm([reply]));
    const d = await drafter.draft(candidate, content, goldenEvidence);
    expect(d.ops).toHaveLength(0);
  });
});
