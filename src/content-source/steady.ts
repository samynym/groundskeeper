import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Project, SyntaxKind } from "ts-morph";
import type { Basis, EditOp, PageRef, Source } from "../types.js";
import type { ContentSource, ReadContent } from "./index.js";

const pexec = promisify(execFile);

export interface SteadyOpts {
  repoPath: string;
  /** Public origin for absolute URLs, e.g. "https://growsteady.me". Defaults to "" (relative). */
  targetOrigin?: string;
  /** Relative path under repoPath for the content index module. Defaults to "lib/benchmarks/content/index.ts". */
  contentModule?: string;
  /** Relative path under repoPath for the curves index module. Defaults to "lib/benchmarks/curves/index.ts". */
  curvesModule?: string;
  loadModule?: (rel: string) => Promise<any>;
}

export class SteadyContentSource implements ContentSource {
  private repoPath: string;
  private targetOrigin: string;
  private contentModule: string;
  private curvesModule: string;
  private loadModule: (rel: string) => Promise<any>;

  constructor(opts: SteadyOpts) {
    this.repoPath = opts.repoPath;
    this.targetOrigin = opts.targetOrigin ?? "";
    this.contentModule = opts.contentModule ?? "lib/benchmarks/content/index.ts";
    this.curvesModule = opts.curvesModule ?? "lib/benchmarks/curves/index.ts";
    this.loadModule = opts.loadModule ?? ((rel) => import(pathToFileURL(join(this.repoPath, rel)).href));
  }

  private async contentArray(): Promise<any[]> {
    const mod = await this.loadModule(this.contentModule);
    if (mod.procedureContents) return mod.procedureContents as any[];
    // fallback: first array export
    for (const v of Object.values(mod)) {
      if (Array.isArray(v)) return v as any[];
    }
    return [];
  }

  private async curvesArray(): Promise<any[]> {
    const mod = await this.loadModule(this.curvesModule);
    if (mod.curves) return mod.curves as any[];
    // fallback: first array export
    for (const v of Object.values(mod)) {
      if (Array.isArray(v)) return v as any[];
    }
    return [];
  }

  async listPages(): Promise<PageRef[]> {
    const curves = await this.curvesArray();
    return curves.map((c: any) => ({
      procedureSlug: c.slug,
      urlSlug: c.urlSlug,
      week: null,
      url: `${this.targetOrigin}/${c.urlSlug}`,
    }));
  }

  async readContent(ref: PageRef): Promise<ReadContent> {
    const contents = await this.contentArray();
    const c = contents.find((x: any) => x.slug === ref.procedureSlug);
    if (!c) throw new Error(`Unknown procedure ${ref.procedureSlug}`);

    // Flatten prose to Record<string, string>
    const prose: Record<string, string> = {};
    prose["metaTitle"] = c.metaTitle ?? "";
    prose["metaDescription"] = c.metaDescription ?? "";
    (c.heroIntro ?? []).forEach((s: string, i: number) => { prose[`heroIntro.${i}`] = s; });
    (c.whatShapesRecovery ?? []).forEach((s: string, i: number) => { prose[`whatShapesRecovery.${i}`] = s; });
    (c.phases ?? []).forEach((phase: any) => {
      (phase.body ?? []).forEach((s: string, i: number) => { prose[`phase.${phase.id}.body.${i}`] = s; });
    });
    (c.faqs ?? []).forEach((faq: any, i: number) => {
      prose[`faq.${i}.q`] = faq.q ?? "";
      prose[`faq.${i}.a`] = faq.a ?? "";
    });

    // Sources come from the curve, not the content object
    const curves = await this.curvesArray();
    const curve = curves.find((x: any) => x.slug === ref.procedureSlug);
    const sources: Source[] = (curve?.sources ?? []) as Source[];

    return { prose, sources };
  }

  async currentBasis(procedureSlug: string, week: number, _band: "low" | "typical" | "high"): Promise<Basis | null> {
    // basis is week-level in the real shape; _band param accepted for interface compatibility but not used
    const curves = await this.curvesArray();
    const curve = curves.find((x: any) => x.slug === procedureSlug);
    const pt = (curve?.painBand as any[] | undefined)?.find((p: any) => p.week === week);
    return pt ? (pt.basis as Basis) : null;
  }

  async lastEditedAt(procedureSlug: string): Promise<number> {
    const file = `lib/benchmarks/content/${procedureSlug}.ts`;
    try {
      const { stdout } = await pexec("git", ["log", "-1", "--format=%ct", "--", file], { cwd: this.repoPath });
      const secs = parseInt(stdout.trim(), 10);
      return Number.isFinite(secs) ? secs * 1000 : 0;
    } catch {
      return 0;
    }
  }

  async interpolatedCount(slug: string): Promise<number> {
    const curves = await this.curvesArray();
    const curve = curves.find((x: any) => x.slug === slug);
    if (!curve) return 0;
    return (curve.painBand as any[]).filter((p: any) => p.basis === "interpolated").length;
  }

  async applyOps(ops: EditOp[]): Promise<void> {
    const project = new Project({ useInMemoryFileSystem: false });

    for (const op of ops) {
      if (op.type === "replaceProse") {
        const contentFile = join(this.repoPath, `lib/benchmarks/content/${op.procedureSlug}.ts`);
        const sf = project.addSourceFileAtPathIfExists(contentFile) ?? project.addSourceFileAtPath(contentFile);
        const objLit = sf.getFirstDescendantByKindOrThrow(SyntaxKind.ObjectLiteralExpression);
        const parts = op.field.split(".");

        if (parts.length === 1) {
          // metaTitle or metaDescription
          objLit.getPropertyOrThrow(parts[0]).asKindOrThrow(SyntaxKind.PropertyAssignment).setInitializer(JSON.stringify(op.newText));
        } else if (parts[0] === "heroIntro" || parts[0] === "whatShapesRecovery") {
          const idx = parseInt(parts[1], 10);
          const arr = objLit.getPropertyOrThrow(parts[0]).asKindOrThrow(SyntaxKind.PropertyAssignment)
            .getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);
          arr.getElements()[idx].replaceWithText(JSON.stringify(op.newText));
        } else if (parts[0] === "phase") {
          // phase.<id>.body.<i>
          const phaseId = parts[1];
          const bodyIdx = parseInt(parts[3], 10);
          const phases = objLit.getPropertyOrThrow("phases").asKindOrThrow(SyntaxKind.PropertyAssignment)
            .getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);
          const phaseEl = phases.getElements().find((el) => {
            const o = el.asKind(SyntaxKind.ObjectLiteralExpression);
            if (!o) return false;
            const idProp = o.getProperty("id")?.asKind(SyntaxKind.PropertyAssignment);
            return idProp?.getInitializer()?.getText() === JSON.stringify(phaseId);
          })?.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
          if (!phaseEl) throw new Error(`Phase "${phaseId}" not found in ${op.procedureSlug}`);
          const body = phaseEl.getPropertyOrThrow("body").asKindOrThrow(SyntaxKind.PropertyAssignment)
            .getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);
          body.getElements()[bodyIdx].replaceWithText(JSON.stringify(op.newText));
        } else if (parts[0] === "faq") {
          // faq.<i>.q or faq.<i>.a
          const idx = parseInt(parts[1], 10);
          const propName = parts[2];
          const faqs = objLit.getPropertyOrThrow("faqs").asKindOrThrow(SyntaxKind.PropertyAssignment)
            .getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);
          const faqEl = faqs.getElements()[idx].asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
          faqEl.getPropertyOrThrow(propName).asKindOrThrow(SyntaxKind.PropertyAssignment).setInitializer(JSON.stringify(op.newText));
        }

        await sf.save();
      } else if (op.type === "addSource") {
        // Sources live on the curve in lib/benchmarks/curves/index.ts
        const curvesFile = join(this.repoPath, "lib/benchmarks/curves/index.ts");
        const sf = project.addSourceFileAtPathIfExists(curvesFile) ?? project.addSourceFileAtPath(curvesFile);
        const curvesVar = sf.getVariableDeclarationOrThrow("curves");
        const curvesArr = curvesVar.getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);

        const procedureEl = curvesArr.getElements().find((el) => {
          const o = el.asKind(SyntaxKind.ObjectLiteralExpression);
          if (!o) return false;
          const slugProp = o.getProperty("slug")?.asKind(SyntaxKind.PropertyAssignment);
          return slugProp?.getInitializer()?.getText() === JSON.stringify(op.procedureSlug);
        })?.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);

        if (!procedureEl) throw new Error(`Procedure ${op.procedureSlug} not found in curves`);

        const sources = procedureEl.getPropertyOrThrow("sources").asKindOrThrow(SyntaxKind.PropertyAssignment)
          .getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);
        sources.addElement(JSON.stringify(op.source));

        await sf.save();
      } else if (op.type === "updateMeta") {
        const contentFile = join(this.repoPath, `lib/benchmarks/content/${op.procedureSlug}.ts`);
        const sf = project.addSourceFileAtPathIfExists(contentFile) ?? project.addSourceFileAtPath(contentFile);
        const objLit = sf.getFirstDescendantByKindOrThrow(SyntaxKind.ObjectLiteralExpression);
        // Map "title" → "metaTitle", "description" → "metaDescription"
        const propName = op.field === "title" ? "metaTitle" : "metaDescription";
        objLit.getPropertyOrThrow(propName).asKindOrThrow(SyntaxKind.PropertyAssignment).setInitializer(JSON.stringify(op.value));
        await sf.save();
      } else if (op.type === "promoteToMeasured") {
        const curvesFile = join(this.repoPath, "lib/benchmarks/curves/index.ts");
        const sf = project.addSourceFileAtPathIfExists(curvesFile) ?? project.addSourceFileAtPath(curvesFile);
        const curvesVar = sf.getVariableDeclarationOrThrow("curves");
        const curvesArr = curvesVar.getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);

        const procedureEl = curvesArr.getElements().find((el) => {
          const o = el.asKind(SyntaxKind.ObjectLiteralExpression);
          if (!o) return false;
          const slugProp = o.getProperty("slug")?.asKind(SyntaxKind.PropertyAssignment);
          return slugProp?.getInitializer()?.getText() === JSON.stringify(op.procedureSlug);
        })?.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);

        if (!procedureEl) throw new Error(`Procedure ${op.procedureSlug} not found in curves`);

        const painBand = procedureEl.getPropertyOrThrow("painBand").asKindOrThrow(SyntaxKind.PropertyAssignment)
          .getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);

        // Exact numeric week match (NOT substring — avoids week:6 matching week:12)
        const pt = painBand.getElements().find((el) => {
          const o = el.asKind(SyntaxKind.ObjectLiteralExpression);
          if (!o) return false;
          const wInit = o.getProperty("week")?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer()?.getText() ?? "";
          return wInit === String(op.week);
        })?.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);

        if (!pt) throw new Error(`painBand point week=${op.week} not found in ${op.procedureSlug}`);

        pt.getPropertyOrThrow(op.band).asKindOrThrow(SyntaxKind.PropertyAssignment).setInitializer(String(op.value));
        pt.getPropertyOrThrow("basis").asKindOrThrow(SyntaxKind.PropertyAssignment).setInitializer(JSON.stringify("measured"));
        pt.getPropertyOrThrow("sourceUrl").asKindOrThrow(SyntaxKind.PropertyAssignment).setInitializer(JSON.stringify(op.sourceUrl));

        await sf.save();
      }
    }
  }
}
