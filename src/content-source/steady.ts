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
  /** Which procedure modules to load (relative paths under repoPath). Defaults to the mini fixture layout. */
  contentModules?: string[];
  curveModules?: string[];
  loadModule?: (rel: string) => Promise<any>;
}

export class SteadyContentSource implements ContentSource {
  private repoPath: string;
  private contentModules: string[];
  private curveModules: string[];
  private loadModule: (rel: string) => Promise<any>;

  constructor(opts: SteadyOpts) {
    this.repoPath = opts.repoPath;
    this.contentModules = opts.contentModules ?? ["lib/benchmarks/content/hip.ts"];
    this.curveModules = opts.curveModules ?? ["lib/benchmarks/curves/hip.ts"];
    this.loadModule = opts.loadModule ?? ((rel) => import(pathToFileURL(join(this.repoPath, rel)).href));
  }

  private async allContent(): Promise<any[]> {
    const mods = await Promise.all(this.contentModules.map((m) => this.loadModule(m)));
    return mods.map((m) => Object.values(m)[0]); // each module default-exports one object
  }
  private async allCurves(): Promise<any[]> {
    const mods = await Promise.all(this.curveModules.map((m) => this.loadModule(m)));
    return mods.map((m) => Object.values(m)[0]);
  }

  async listPages(): Promise<PageRef[]> {
    const content = await this.allContent();
    const pages: PageRef[] = [];
    for (const c of content) {
      pages.push({ procedureSlug: c.slug, urlSlug: c.urlSlug, week: null, url: `/${c.urlSlug}` });
    }
    return pages;
  }

  async readContent(ref: PageRef): Promise<ReadContent> {
    const c = (await this.allContent()).find((x) => x.slug === ref.procedureSlug);
    if (!c) throw new Error(`Unknown procedure ${ref.procedureSlug}`);
    return { prose: { ...c.prose }, sources: (c.sources ?? []) as Source[] };
  }

  async currentBasis(procedureSlug: string, week: number, band: "low" | "typical" | "high"): Promise<Basis | null> {
    const curve = (await this.allCurves()).find((x) => x.slug === procedureSlug);
    const pt = curve?.points?.find((p: any) => p.week === week && p.band === band);
    return pt ? (pt.basis as Basis) : null;
  }

  async lastEditedAt(procedureSlug: string): Promise<number> {
    const file = this.contentModules.find((m) => m.includes(procedureSlug.split("-")[0])) ?? this.contentModules[0];
    try {
      const { stdout } = await pexec("git", ["log", "-1", "--format=%ct", "--", file], { cwd: this.repoPath });
      const secs = parseInt(stdout.trim(), 10);
      return Number.isFinite(secs) ? secs * 1000 : 0;
    } catch {
      return 0;
    }
  }

  async applyOps(ops: EditOp[]): Promise<void> {
    const project = new Project({ useInMemoryFileSystem: false });
    const contentPath = join(this.repoPath, this.contentModules[0]);
    const curvePath = join(this.repoPath, this.curveModules[0]);

    for (const op of ops) {
      if (op.type === "replaceProse" || op.type === "addSource" || op.type === "updateMeta") {
        const sf = project.addSourceFileAtPathIfExists(contentPath) ?? project.addSourceFileAtPath(contentPath);
        const objLit = sf.getFirstDescendantByKindOrThrow(SyntaxKind.ObjectLiteralExpression);

        if (op.type === "replaceProse") {
          const prose = objLit.getPropertyOrThrow("prose").asKindOrThrow(SyntaxKind.PropertyAssignment)
            .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
          const field = prose.getPropertyOrThrow(op.field).asKindOrThrow(SyntaxKind.PropertyAssignment);
          field.setInitializer(JSON.stringify(op.newText));
        } else if (op.type === "addSource") {
          const sources = objLit.getPropertyOrThrow("sources").asKindOrThrow(SyntaxKind.PropertyAssignment)
            .getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);
          sources.addElement(JSON.stringify(op.source));
        } else {
          // updateMeta: content module has a `meta` object keyed by "pillar" or `week-${n}`
          const meta = objLit.getPropertyOrThrow("meta").asKindOrThrow(SyntaxKind.PropertyAssignment)
            .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
          const key = op.week === null ? "pillar" : `week-${op.week}`;
          const entry = meta.getPropertyOrThrow(key).asKindOrThrow(SyntaxKind.PropertyAssignment)
            .getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
          entry.getPropertyOrThrow(op.field).asKindOrThrow(SyntaxKind.PropertyAssignment).setInitializer(JSON.stringify(op.value));
        }
        await sf.save();
      } else if (op.type === "promoteToMeasured") {
        const sf = project.addSourceFileAtPathIfExists(curvePath) ?? project.addSourceFileAtPath(curvePath);
        const points = sf.getFirstDescendantByKindOrThrow(SyntaxKind.ArrayLiteralExpression);
        const pt = points.getElements().find((el) => {
          const o = el.asKind(SyntaxKind.ObjectLiteralExpression);
          if (!o) return false;
          const w = o.getProperty("week")?.getText() ?? "";
          const b = o.getProperty("band")?.getText() ?? "";
          return w.includes(String(op.week)) && b.includes(op.band);
        })?.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
        if (!pt) throw new Error(`curve point ${op.week}/${op.band} not found`);
        pt.getPropertyOrThrow("value").asKindOrThrow(SyntaxKind.PropertyAssignment).setInitializer(String(op.value));
        pt.getPropertyOrThrow("basis").asKindOrThrow(SyntaxKind.PropertyAssignment).setInitializer(JSON.stringify("measured"));
        pt.getPropertyOrThrow("sourceUrl").asKindOrThrow(SyntaxKind.PropertyAssignment).setInitializer(JSON.stringify(op.sourceUrl));
        await sf.save();
      }
    }
  }
}
