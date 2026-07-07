import type { GeoAnswer, GeoEngineClient } from "./geo-engine.js";
import type { TargetSet } from "./targets.js";

export function hostOf(url: string): string | null {
  try { return new URL(url).host.toLowerCase(); } catch { return null; }
}

export function isCited(answer: GeoAnswer, brandDomain: string): boolean {
  const d = brandDomain.toLowerCase();
  return answer.citedUrls.some((u) => {
    const h = hostOf(u);
    return h === d || (h ? h.endsWith("." + d) : false);
  });
}

export function isMentioned(answer: GeoAnswer, brandDomain: string, brandPhrases: string[]): boolean {
  const text = answer.answerText.toLowerCase();
  if (text.includes(brandDomain.toLowerCase())) return true;
  return brandPhrases.some((p) => p !== "" && text.includes(p.toLowerCase()));
}

export interface EngineResult { citationRate: number; mentionRate: number; runs: GeoAnswer[] }
export interface QuestionResult {
  question: string;
  control: boolean;
  perEngine: Record<string, EngineResult>;
  citationRate: number;
  mentionRate: number;
}
export interface GeoScore { citationRate: number; mentionRate: number }
export interface GeoSnapshot { results: QuestionResult[]; targetScore: GeoScore; controlScore: GeoScore }

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

export async function snapshotGeo(
  targets: TargetSet,
  engines: GeoEngineClient[],
  opts: { runs: number },
): Promise<GeoSnapshot> {
  const runs = Math.max(1, opts.runs);
  const results: QuestionResult[] = [];

  for (const item of targets.items) {
    for (const question of item.questions) {
      const perEngine: Record<string, EngineResult> = {};
      for (const engine of engines) {
        const raw: GeoAnswer[] = [];
        for (let k = 0; k < runs; k++) {
          try { raw.push(await engine.ask(question)); }
          catch { raw.push({ answerText: "", citedUrls: [], ok: false }); }
        }
        const ok = raw.filter((a) => a.ok);
        perEngine[engine.name] = {
          citationRate: ok.length ? ok.filter((a) => isCited(a, targets.brandDomain)).length / ok.length : 0,
          mentionRate: ok.length ? ok.filter((a) => isMentioned(a, targets.brandDomain, targets.brandPhrases)).length / ok.length : 0,
          runs: raw,
        };
      }
      const active = Object.values(perEngine).filter((e) => e.runs.some((r) => r.ok));
      results.push({
        question, control: item.control, perEngine,
        citationRate: mean(active.map((e) => e.citationRate)),
        mentionRate: mean(active.map((e) => e.mentionRate)),
      });
    }
  }

  const nonControl = results.filter((r) => !r.control);
  const control = results.filter((r) => r.control);
  return {
    results,
    targetScore: { citationRate: mean(nonControl.map((r) => r.citationRate)), mentionRate: mean(nonControl.map((r) => r.mentionRate)) },
    controlScore: { citationRate: mean(control.map((r) => r.citationRate)), mentionRate: mean(control.map((r) => r.mentionRate)) },
  };
}
