import { describe, it, expect } from "vitest";
import { runProbe } from "./prober.js";
import { FakeEngine, type GeoAnswer } from "../measure/geo-engine.js";
import type { Rung } from "./ladder.js";

const ans = (t: string): GeoAnswer => ({ answerText: t, citedUrls: [], retrievedUrls: [], engineQueries: null, ok: true });
const rung: Rung = { id: "R0_DOMAIN_LITERAL", scope: "domain", pageUrl: null, query: "growsteady.me" };

describe("runProbe", () => {
  it("asks each engine K times per rung and keeps every raw answer", async () => {
    const e = new FakeEngine("e1", [ans("a"), ans("b")]);
    const out = await runProbe([rung], [e], { runs: 2 });
    expect(out).toHaveLength(1);
    expect(out[0].runs.map((r) => r.answer.answerText)).toEqual(["a", "b"]);
    expect(out[0].runs.every((r) => r.engine === "e1")).toBe(true);
  });
  it("records an engine throw as a failed run (ok:false, nulls), never aborts", async () => {
    const e = new FakeEngine("e1", [ans("a")]); // 2nd ask throws "exhausted"
    const out = await runProbe([rung], [e], { runs: 2 });
    expect(out[0].runs[1].answer).toEqual({ answerText: "", citedUrls: [], retrievedUrls: null, engineQueries: null, ok: false });
  });
  it("clamps runs to at least 1", async () => {
    const e = new FakeEngine("e1", [ans("a")]);
    const out = await runProbe([rung], [e], { runs: 0 });
    expect(out[0].runs).toHaveLength(1);
  });
});
