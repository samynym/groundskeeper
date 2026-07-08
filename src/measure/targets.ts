import { readFileSync } from "node:fs";

export interface TargetItem {
  pageUrl: string;
  procedureSlug: string;
  questions: string[];
  control: boolean;
}

export interface TargetSet {
  brandDomain: string;
  brandPhrases: string[];
  items: TargetItem[];
}

export function loadTargets(path: string): TargetSet {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  if (typeof raw.brandDomain !== "string" || !raw.brandDomain) throw new Error("targets: brandDomain required");
  if (!Array.isArray(raw.items)) throw new Error("targets: items[] required");
  const brandPhrases = Array.isArray(raw.brandPhrases) ? (raw.brandPhrases as unknown[]).map(String) : [];
  const items: TargetItem[] = (raw.items as unknown[]).map((v, i) => {
    const it = v as Record<string, unknown>;
    if (typeof it.pageUrl !== "string" || !it.pageUrl) throw new Error(`targets: items[${i}].pageUrl required`);
    return {
      pageUrl: it.pageUrl,
      procedureSlug: String(it.procedureSlug ?? ""),
      questions: Array.isArray(it.questions) ? (it.questions as unknown[]).map(String) : [],
      control: Boolean(it.control),
    };
  });
  return { brandDomain: raw.brandDomain, brandPhrases, items };
}
