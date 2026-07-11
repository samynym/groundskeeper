import type { GeoAnswer, GeoEngineClient } from "../measure/geo-engine.js";
import type { Rung } from "./ladder.js";

export interface RungRun { engine: string; answer: GeoAnswer }
export interface RungResult { rung: Rung; runs: RungRun[] }

/**
 * Ask every rung K times per engine. Presence is an existence claim, so the
 * classifier unions over runs; all raw answers are kept for audit. A throwing
 * engine records a failed run (mirrors snapshotGeo's catch), never aborts.
 */
export async function runProbe(
  rungs: Rung[], engines: GeoEngineClient[], opts: { runs: number },
): Promise<RungResult[]> {
  const k = Math.max(1, opts.runs);
  const out: RungResult[] = [];
  for (const rung of rungs) {
    const runs: RungRun[] = [];
    for (const engine of engines) {
      for (let i = 0; i < k; i++) {
        try {
          runs.push({ engine: engine.name, answer: await engine.ask(rung.query) });
        } catch {
          runs.push({
            engine: engine.name,
            answer: { answerText: "", citedUrls: [], retrievedUrls: null, engineQueries: null, ok: false },
          });
        }
      }
    }
    out.push({ rung, runs });
  }
  return out;
}
