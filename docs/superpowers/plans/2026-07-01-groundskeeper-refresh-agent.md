# Groundskeeper Refresh Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a closed-world content refresh agent that, per run, picks one underperforming/stale page on a target site, drafts grounded edits, proves every claim traces to a cited source, verifies the build, and opens a PR for human approval.

**Architecture:** A standalone TypeScript/Node (ESM) CLI in its own repo. It operates on a local checkout of the target site's repo. The drafter (LLM) emits a small set of **structured edit operations**, not free-form diffs. A two-layer guard (mechanical + adversarial LLM judge) validates every operation against a curated evidence set before any edit is applied. Passing edits are applied via `ts-morph`, the target's build is verified, and a PR is opened via `gh`. First (and only, for MVP) `ContentSource` adapter targets Steady's `lib/benchmarks/*` layout.

**Tech Stack:** TypeScript, Node 20+ (ESM), vitest, zod, ts-morph, @anthropic-ai/sdk (`claude-sonnet-4-6`), tsx, `git` + `gh` CLIs.

## Global Constraints

- **Closed-world rule (non-negotiable):** No edit operation may introduce a `sourceUrl` that does not already exist in the target's evidence base or dossier. A claim that can't cite a known source does not ship.
- **Guard runs on the agent's own output** before any human sees it. **False negatives (a fabricated claim passing) are the only unacceptable failure** — tune to over-reject.
- **One target per run.** The selector picks exactly one page.
- **No auto-merge.** The agent is autonomous up to opening the PR; a human merges.
- **Structured edits only.** The agent mutates content through a fixed set of `EditOp` types via `ts-morph` — never free-form file writes.
- **LLM is injectable.** All LLM access goes through the `LlmClient` interface; unit tests use a fake and never hit the network. Model id: `claude-sonnet-4-6`.
- **Node ESM.** `"type": "module"`; all imports use explicit `.js` extensions in emitted code (ts-morph/tsx resolve `.ts`).
- When implementing any task that calls the Anthropic SDK, **invoke the `claude-api` skill first** to confirm current SDK usage; model ids in this plan are authoritative as of 2026-07-01.

---

## File Structure

```
groundskeeper/
  package.json                     # ESM, deps, scripts (test/build)
  tsconfig.json
  vitest.config.ts
  .env.example                     # required env vars, no secrets
  src/
    types.ts                       # all shared types (the spine)
    config.ts                      # env → validated Config (zod)
    llm/
      client.ts                    # LlmClient interface + Anthropic impl + FakeLlm
    content-source/
      index.ts                     # ContentSource interface
      steady.ts                    # Steady adapter: read + structured writes (ts-morph)
    performance/
      gsc.ts                       # PerformanceSignal (spawns seo-loop.mjs)
    selector/
      target-selector.ts           # scoring + pick one
    evidence/
      retriever.ts                 # EvidenceRetriever
    drafter/
      prompts.ts                   # drafter system/user prompt builders
      refresh-drafter.ts           # LLM → EditOp[] (zod-validated)
    guard/
      mechanical.ts                # Layer 1
      judge.ts                     # Layer 2 (LLM)
      grounding-guard.ts           # compose L1 + L2
    build/
      verifier.ts                  # BuildVerifier (runs target commands)
    pr/
      pr-writer.ts                 # git branch/commit/push + gh pr create
    orchestrator.ts                # one cycle
    cli.ts                         # entrypoint
  test/
    fixtures/
      steady-mini/                 # tiny fake target repo for adapter/build tests
      evidence.ts                  # golden EvidenceSet + grounded/fabricated ops
    *.test.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `src/index-smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm test` and `npm run build`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "groundskeeper",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "groundskeeper": "./dist/cli.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx src/cli.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.71.0",
    "dotenv": "^16.4.5",
    "ts-morph": "^24.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts", "test/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 4: Write `.env.example`**

```bash
# Local checkout of the target site repo (Steady web)
TARGET_REPO_PATH=/Users/samynaayma/dev/perso/steady
# Target site public origin
TARGET_ORIGIN=https://growsteady.me
# GSC (reused from Steady's seo-loop.mjs)
GSC_SA_JSON=/absolute/path/to/service-account.json
GSC_PROPERTY=sc-domain:growsteady.me
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
GROUNDSKEEPER_MODEL=claude-sonnet-4-6
# Git base branch on the target repo
TARGET_BASE_BRANCH=main
```

- [ ] **Step 5: Write smoke test `src/index-smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("scaffold", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Install and run**

Run: `npm install && npm test`
Expected: 1 passing test.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold groundskeeper (ts, esm, vitest)"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/types.ts`, `src/types.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: all shared types used by every later task (exact names below).

- [ ] **Step 1: Write the type-shape test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/types.test.ts`
Expected: FAIL — cannot find module `./types.js`.

- [ ] **Step 3: Write `src/types.ts`**

```ts
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

export const isReplaceProse = (o: EditOp): o is Extract<EditOp, { type: "replaceProse" }> => o.type === "replaceProse";
export const isAddSource = (o: EditOp): o is Extract<EditOp, { type: "addSource" }> => o.type === "addSource";
export const isUpdateMeta = (o: EditOp): o is Extract<EditOp, { type: "updateMeta" }> => o.type === "updateMeta";
export const isPromote = (o: EditOp): o is Extract<EditOp, { type: "promoteToMeasured" }> => o.type === "promoteToMeasured";

/** Claims carried by an op (for guard iteration). promoteToMeasured/addSource carry an implicit claim. */
export function claimsOf(op: EditOp): ClaimRef[] {
  switch (op.type) {
    case "replaceProse": return op.claims;
    case "updateMeta": return op.claims;
    case "addSource": return [{ text: op.source.title, sourceUrl: op.source.url }];
    case "promoteToMeasured": return [{ text: `${op.band}=${op.value}`, sourceUrl: op.sourceUrl }];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/types.test.ts && git commit -m "feat: shared types (EditOp spine, EvidenceSet, GuardResult)"
```

---

### Task 3: Config loader

**Files:**
- Create: `src/config.ts`, `src/config.test.ts`

**Interfaces:**
- Consumes: env
- Produces: `loadConfig(env?): Config` where `Config = { targetRepoPath, targetOrigin, gscSaJson, gscProperty, anthropicApiKey, model, baseBranch }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("parses a full env", () => {
    const c = loadConfig({
      TARGET_REPO_PATH: "/tmp/steady", TARGET_ORIGIN: "https://growsteady.me",
      GSC_SA_JSON: "/tmp/sa.json", GSC_PROPERTY: "sc-domain:growsteady.me",
      ANTHROPIC_API_KEY: "sk-ant-x", TARGET_BASE_BRANCH: "main",
    });
    expect(c.targetRepoPath).toBe("/tmp/steady");
    expect(c.model).toBe("claude-sonnet-4-6"); // default
  });
  it("throws on missing required var", () => {
    expect(() => loadConfig({})).toThrow(/TARGET_REPO_PATH/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/config.ts`**

```ts
import { z } from "zod";

const Schema = z.object({
  TARGET_REPO_PATH: z.string().min(1),
  TARGET_ORIGIN: z.string().url(),
  GSC_SA_JSON: z.string().min(1),
  GSC_PROPERTY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  GROUNDSKEEPER_MODEL: z.string().default("claude-sonnet-4-6"),
  TARGET_BASE_BRANCH: z.string().default("main"),
});

export interface Config {
  targetRepoPath: string;
  targetOrigin: string;
  gscSaJson: string;
  gscProperty: string;
  anthropicApiKey: string;
  model: string;
  baseBranch: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const p = Schema.safeParse(env);
  if (!p.success) {
    const missing = p.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid/missing config: ${missing}`);
  }
  const e = p.data;
  return {
    targetRepoPath: e.TARGET_REPO_PATH,
    targetOrigin: e.TARGET_ORIGIN,
    gscSaJson: e.GSC_SA_JSON,
    gscProperty: e.GSC_PROPERTY,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    model: e.GROUNDSKEEPER_MODEL,
    baseBranch: e.TARGET_BASE_BRANCH,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts && git commit -m "feat: zod-validated config loader"
```

---

### Task 4: LLM client interface + fake

**Files:**
- Create: `src/llm/client.ts`, `src/llm/client.test.ts`

**Interfaces:**
- Consumes: `Config` (for the Anthropic impl)
- Produces: `interface LlmClient { complete(o: { system: string; user: string; maxTokens?: number }): Promise<string> }`, `class AnthropicClient implements LlmClient`, `class FakeLlm implements LlmClient` (queue of scripted responses).

- [ ] **Step 1: Write the failing test (fake only — no network)**

```ts
import { describe, it, expect } from "vitest";
import { FakeLlm } from "./client.js";

describe("FakeLlm", () => {
  it("returns scripted responses in order and records calls", async () => {
    const llm = new FakeLlm(["first", "second"]);
    expect(await llm.complete({ system: "s", user: "u1" })).toBe("first");
    expect(await llm.complete({ system: "s", user: "u2" })).toBe("second");
    expect(llm.calls.map((c) => c.user)).toEqual(["u1", "u2"]);
  });
  it("throws when exhausted", async () => {
    const llm = new FakeLlm([]);
    await expect(llm.complete({ system: "s", user: "u" })).rejects.toThrow(/exhausted/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/llm/client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/llm/client.ts`**

> When implementing the Anthropic branch, invoke the `claude-api` skill to confirm the SDK call shape. Model id `claude-sonnet-4-6` is authoritative here.

```ts
import Anthropic from "@anthropic-ai/sdk";

export interface LlmClient {
  complete(o: { system: string; user: string; maxTokens?: number }): Promise<string>;
}

export class AnthropicClient implements LlmClient {
  private client: Anthropic;
  constructor(private apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey });
  }
  async complete(o: { system: string; user: string; maxTokens?: number }): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: o.maxTokens ?? 4096,
      system: o.system,
      messages: [{ role: "user", content: o.user }],
    });
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
}

export class FakeLlm implements LlmClient {
  public calls: Array<{ system: string; user: string }> = [];
  constructor(private queue: string[]) {}
  async complete(o: { system: string; user: string; maxTokens?: number }): Promise<string> {
    this.calls.push({ system: o.system, user: o.user });
    if (this.queue.length === 0) throw new Error("FakeLlm exhausted");
    return this.queue.shift()!;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/llm/client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm/ && git commit -m "feat: LlmClient interface + Anthropic impl + FakeLlm"
```

---

### Task 5: `steady-mini` fixture + ContentSource interface

**Files:**
- Create: `test/fixtures/steady-mini/lib/benchmarks/content/hip.ts`
- Create: `test/fixtures/steady-mini/lib/benchmarks/curves/hip.ts`
- Create: `src/content-source/index.ts`, `src/content-source/index.test.ts`

**Interfaces:**
- Consumes: `PageRef`, `PageContent`-ish types
- Produces: `interface ContentSource` with methods `listPages(): Promise<PageRef[]>`, `readContent(ref): Promise<{ prose: Record<string,string>; sources: Source[] }>`, `currentBasis(procedureSlug, week, band): Promise<Basis | null>`, `applyOps(ops: EditOp[]): Promise<void>`, `lastEditedAt(procedureSlug): Promise<number>` (epoch ms via git).

- [ ] **Step 1: Write the mini fixture — `content/hip.ts`**

```ts
// Mirrors Steady's shape closely enough for the adapter to parse.
export const hipContent = {
  slug: "hip-arthroscopy-fai",
  urlSlug: "hip-arthroscopy-recovery-timeline",
  prose: {
    intro: "Recovery after hip arthroscopy for FAI is gradual.",
    outlook: "Most patients return to sport within a year.",
  },
  sources: [
    { title: "Cunningham 2017", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/", tier: "cohort", reliabilityScore: 7.5 },
  ],
};
```

- [ ] **Step 2: Write the mini fixture — `curves/hip.ts`**

```ts
export const hipCurve = {
  slug: "hip-arthroscopy-fai",
  points: [
    { week: 0, band: "typical", value: 5.2, basis: "measured", sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/" },
    { week: 6, band: "typical", value: 3.1, basis: "interpolated", sourceUrl: "" },
  ],
};
```

- [ ] **Step 3: Write the failing interface test**

```ts
import { describe, it, expect } from "vitest";
import type { ContentSource } from "./index.js";

describe("ContentSource interface", () => {
  it("is a type-only module that compiles", () => {
    const noop = (_cs: ContentSource) => true;
    expect(typeof noop).toBe("function");
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run src/content-source/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Write `src/content-source/index.ts`**

```ts
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
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/content-source/index.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/content-source/index.ts src/content-source/index.test.ts test/fixtures/steady-mini/ && git commit -m "feat: ContentSource interface + steady-mini fixture"
```

---

### Task 6: Steady adapter — READ

**Files:**
- Create: `src/content-source/steady.ts`, `src/content-source/steady-read.test.ts`

**Interfaces:**
- Consumes: `ContentSource`, `Config.targetRepoPath`; fixture layout from Task 5.
- Produces: `class SteadyContentSource implements ContentSource` (read methods implemented; `applyOps` stubbed to throw "not implemented" until Task 7). Read strategy: dynamic `import()` of the fixture/target TS modules via a resolver injected in the constructor so tests point at `steady-mini`.

> **Note on read strategy:** reading uses runtime `import()` of the data modules (accurate values, no AST needed). Writing (Task 7) uses `ts-morph`. The constructor takes `{ repoPath, loadModule }` where `loadModule(relPath)` defaults to `(p) => import(pathToFileURL(join(repoPath, p)).href)` and is overridden in tests to load the fixture.

- [ ] **Step 1: Write the failing read test**

```ts
import { describe, it, expect } from "vitest";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { SteadyContentSource } from "./steady.js";

const fixtureRoot = resolve(__dirname, "../../test/fixtures/steady-mini");
const loadModule = (rel: string) => import(pathToFileURL(join(fixtureRoot, rel)).href);

describe("SteadyContentSource read", () => {
  const cs = new SteadyContentSource({ repoPath: fixtureRoot, loadModule });

  it("lists the pillar page", async () => {
    const pages = await cs.listPages();
    expect(pages.some((p) => p.urlSlug === "hip-arthroscopy-recovery-timeline" && p.week === null)).toBe(true);
  });
  it("reads prose + sources", async () => {
    const c = await cs.readContent({ procedureSlug: "hip-arthroscopy-fai", urlSlug: "hip-arthroscopy-recovery-timeline", week: null, url: "x" });
    expect(c.prose.intro).toMatch(/gradual/);
    expect(c.sources[0].url).toContain("PMC5721367");
  });
  it("returns the basis of a curve band", async () => {
    expect(await cs.currentBasis("hip-arthroscopy-fai", 6, "typical")).toBe("interpolated");
    expect(await cs.currentBasis("hip-arthroscopy-fai", 99, "typical")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/content-source/steady-read.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/content-source/steady.ts` (read half)**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

  async applyOps(_ops: EditOp[]): Promise<void> {
    throw new Error("applyOps not implemented (Task 7)");
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/content-source/steady-read.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/content-source/steady.ts src/content-source/steady-read.test.ts && git commit -m "feat: Steady adapter read (import-based) + git mtime"
```

---

### Task 7: Steady adapter — structured WRITE via ts-morph

**Files:**
- Modify: `src/content-source/steady.ts` (replace `applyOps`)
- Create: `src/content-source/steady-write.test.ts`
- Create: `test/fixtures/steady-mini/lib/benchmarks/content/hip.ts` is reused; the test copies it to a temp dir.

**Interfaces:**
- Consumes: `EditOp` (Task 2), the fixture module.
- Produces: `applyOps` that mutates the *source files* in `repoPath` using ts-morph, for `replaceProse`, `addSource`, `updateMeta`(pillar meta stored in content module `meta` field), `promoteToMeasured`.

> The adapter locates the exported object literal, then the target property, and edits it. It preserves everything else. Writes go to the real files under `repoPath` (tests use a temp copy).

- [ ] **Step 1: Write the failing write test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SteadyContentSource } from "./steady.js";

const fixtureRoot = resolve(__dirname, "../../test/fixtures/steady-mini");

function freshCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "gk-"));
  cpSync(fixtureRoot, dir, { recursive: true });
  return dir;
}

describe("SteadyContentSource applyOps", () => {
  let repo: string;
  let cs: SteadyContentSource;
  beforeEach(() => {
    repo = freshCopy();
    cs = new SteadyContentSource({
      repoPath: repo,
      loadModule: (rel) => import(pathToFileURL(join(repo, rel)).href + `?t=${Date.now()}`),
    });
  });

  it("replaceProse edits the prose field in source", async () => {
    await cs.applyOps([{ type: "replaceProse", procedureSlug: "hip-arthroscopy-fai", field: "intro", oldText: "Recovery after hip arthroscopy for FAI is gradual.", newText: "Recovery is gradual and measured in weeks.", claims: [] }]);
    const src = readFileSync(join(repo, "lib/benchmarks/content/hip.ts"), "utf8");
    expect(src).toContain("measured in weeks");
    expect(src).not.toContain("FAI is gradual.");
  });

  it("addSource appends to the sources array", async () => {
    await cs.applyOps([{ type: "addSource", procedureSlug: "hip-arthroscopy-fai", source: { title: "Memon RTP meta 2019", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8530429/", tier: "meta-analysis", reliabilityScore: 8.0 } }]);
    const src = readFileSync(join(repo, "lib/benchmarks/content/hip.ts"), "utf8");
    expect(src).toContain("PMC8530429");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/content-source/steady-write.test.ts`
Expected: FAIL — `applyOps not implemented`.

- [ ] **Step 3: Replace `applyOps` in `src/content-source/steady.ts`**

Add at top: `import { Project, SyntaxKind } from "ts-morph";`

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/content-source/steady-write.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/content-source/steady.ts src/content-source/steady-write.test.ts && git commit -m "feat: Steady adapter structured writes via ts-morph"
```

---

### Task 8: EvidenceRetriever

**Files:**
- Create: `src/evidence/retriever.ts`, `src/evidence/retriever.test.ts`

**Interfaces:**
- Consumes: `ContentSource.readContent`, curve points (via a `loadCurve` fn), dossier text (via a `readDossier` fn injected for testability).
- Produces: `class EvidenceRetriever { retrieve(ref: PageRef): Promise<EvidenceSet> }`. Builds `knownSourceUrls` = union of `sources[].url` + every URL found in the dossier markdown. `facts` = one `EvidenceItem` per curve point that has a `sourceUrl`, plus dossier lines that contain a URL. `numbers` = numeric tokens extracted from each fact's text.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { EvidenceRetriever } from "./retriever.js";
import type { PageRef } from "../types.js";

const ref: PageRef = { procedureSlug: "hip-arthroscopy-fai", urlSlug: "u", week: null, url: "x" };

const retriever = new EvidenceRetriever({
  readContent: async () => ({ prose: {}, sources: [{ title: "Cunningham 2017", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/", tier: "cohort", reliabilityScore: 7.5 }] }),
  loadCurvePoints: async () => [{ week: 0, band: "typical", value: 5.2, basis: "measured", sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/" }],
  readDossier: async () => "Memon RTP meta finds 87% return to sport https://pmc.ncbi.nlm.nih.gov/articles/PMC8530429/",
});

describe("EvidenceRetriever", () => {
  it("unions source URLs from sources[] and dossier", async () => {
    const ev = await retriever.retrieve(ref);
    expect(ev.knownSourceUrls.has("https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/")).toBe(true);
    expect(ev.knownSourceUrls.has("https://pmc.ncbi.nlm.nih.gov/articles/PMC8530429/")).toBe(true);
  });
  it("extracts numbers from facts", async () => {
    const ev = await retriever.retrieve(ref);
    const dossierFact = ev.facts.find((f) => f.claimText.includes("return to sport"));
    expect(dossierFact?.numbers).toContain(87);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/evidence/retriever.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/evidence/retriever.ts`**

```ts
import type { EvidenceItem, EvidenceSet, PageRef, Source } from "../types.js";
import type { ReadContent } from "../content-source/index.js";

const URL_RE = /https?:\/\/[^\s)]+/g;

export function extractNumbers(text: string): number[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

export interface RetrieverDeps {
  readContent(ref: PageRef): Promise<ReadContent>;
  loadCurvePoints(procedureSlug: string): Promise<Array<{ sourceUrl: string; value: number; band: string; week: number; basis: string }>>;
  readDossier(procedureSlug: string): Promise<string>;
}

export class EvidenceRetriever {
  constructor(private deps: RetrieverDeps) {}

  async retrieve(ref: PageRef): Promise<EvidenceSet> {
    const { sources } = await this.deps.readContent(ref);
    const points = await this.deps.loadCurvePoints(ref.procedureSlug);
    const dossier = await this.deps.readDossier(ref.procedureSlug);

    const known = new Set<string>();
    for (const s of sources) known.add(s.url);
    for (const url of dossier.match(URL_RE) ?? []) known.add(url);
    for (const p of points) if (p.sourceUrl) known.add(p.sourceUrl);

    const facts: EvidenceItem[] = [];
    for (const p of points) {
      if (!p.sourceUrl) continue;
      const title = sources.find((s) => s.url === p.sourceUrl)?.title ?? p.sourceUrl;
      const claimText = `week ${p.week} ${p.band} = ${p.value}`;
      facts.push({ claimText, sourceUrl: p.sourceUrl, sourceTitle: title, numbers: extractNumbers(claimText) });
    }
    for (const line of dossier.split(/\n+/)) {
      const url = line.match(URL_RE)?.[0];
      if (!url) continue;
      facts.push({ claimText: line.trim(), sourceUrl: url, sourceTitle: url, numbers: extractNumbers(line) });
    }
    return { ref, sources: sources as Source[], knownSourceUrls: known, facts };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/evidence/retriever.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/evidence/ && git commit -m "feat: EvidenceRetriever (union known URLs, extract fact numbers)"
```

---

### Task 9: Golden fixtures for the guard

**Files:**
- Create: `test/fixtures/evidence.ts`

**Interfaces:**
- Consumes: types.
- Produces: `goldenEvidence: EvidenceSet`, `groundedOps: EditOp[]`, `fabricatedOps: EditOp[]` (each fabricated op violates closed-world in exactly one way, with a `// why` comment).

- [ ] **Step 1: Write `test/fixtures/evidence.ts`**

```ts
import type { EditOp, EvidenceSet, PageRef } from "../../src/types.js";

const ref: PageRef = { procedureSlug: "hip-arthroscopy-fai", urlSlug: "hip-arthroscopy-recovery-timeline", week: null, url: "https://growsteady.me/hip-arthroscopy-recovery-timeline" };

const KNOWN_A = "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/";
const KNOWN_B = "https://pmc.ncbi.nlm.nih.gov/articles/PMC8530429/";

export const goldenEvidence: EvidenceSet = {
  ref,
  sources: [{ title: "Cunningham 2017", url: KNOWN_A, tier: "cohort", reliabilityScore: 7.5 }],
  knownSourceUrls: new Set([KNOWN_A, KNOWN_B]),
  facts: [
    { claimText: "week 0 typical = 5.2", sourceUrl: KNOWN_A, sourceTitle: "Cunningham 2017", numbers: [0, 5.2] },
    { claimText: "87% return to sport by 12 months", sourceUrl: KNOWN_B, sourceTitle: "Memon 2019", numbers: [87, 12] },
  ],
};

export const groundedOps: EditOp[] = [
  // claim cites a known URL, and its number (87) exists in a fact
  { type: "replaceProse", procedureSlug: ref.procedureSlug, field: "outlook", oldText: "Most return within a year.", newText: "About 87% of patients return to sport by 12 months.", claims: [{ text: "87% return to sport by 12 months", sourceUrl: KNOWN_B }] },
  // adding a source that exists in the dossier/known set
  { type: "addSource", procedureSlug: ref.procedureSlug, source: { title: "Memon 2019", url: KNOWN_B, tier: "meta-analysis", reliabilityScore: 8.0 } },
];

export const fabricatedOps: EditOp[] = [
  // why: cites a URL not in knownSourceUrls (invented source)
  { type: "replaceProse", procedureSlug: ref.procedureSlug, field: "outlook", oldText: "x", newText: "95% return in 8 weeks.", claims: [{ text: "95% return in 8 weeks", sourceUrl: "https://example.com/made-up" }] },
  // why: number 95 in prose is not present in any fact for the cited (known) source
  { type: "replaceProse", procedureSlug: ref.procedureSlug, field: "outlook", oldText: "x", newText: "95% return to sport by 12 months.", claims: [{ text: "95% return to sport by 12 months", sourceUrl: KNOWN_B }] },
  // why: addSource with an invented URL
  { type: "addSource", procedureSlug: ref.procedureSlug, source: { title: "Fake study", url: "https://example.com/nope", tier: "cohort", reliabilityScore: 9 } },
];
```

- [ ] **Step 2: Commit (no test yet — consumed by Task 10)**

```bash
git add test/fixtures/evidence.ts && git commit -m "test: golden evidence + grounded/fabricated ops fixtures"
```

---

### Task 10: Mechanical guard (Layer 1)

**Files:**
- Create: `src/guard/mechanical.ts`, `src/guard/mechanical.test.ts`

**Interfaces:**
- Consumes: `EvidenceSet`, `EditOp`, `claimsOf`, `extractNumbers`; `ContentSource.currentBasis` for promote checks.
- Produces: `mechanicalGuard(op, evidence, deps): Promise<GuardVerdict>` where `deps = { currentBasis }`. Rules (each failure appends a reason):
  - every claim's `sourceUrl` ∈ `evidence.knownSourceUrls`;
  - for `replaceProse`/`updateMeta`: every number in `newText`/`value` must appear in some `evidence.facts[].numbers` **or** in the claim's own cited fact;
  - for `addSource`: `source.url` ∈ known;
  - for `promoteToMeasured`: `sourceUrl` ∈ known **and** `value` ∈ numbers of a fact citing that url **and** `currentBasis(...)==="interpolated"`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mechanicalGuard } from "./mechanical.js";
import { goldenEvidence, groundedOps, fabricatedOps } from "../../test/fixtures/evidence.js";

const deps = { currentBasis: async () => "interpolated" as const };

describe("mechanicalGuard", () => {
  it("passes grounded ops", async () => {
    for (const op of groundedOps) {
      const v = await mechanicalGuard(op, goldenEvidence, deps);
      expect(v.ok, `${op.type}: ${v.failures.join("; ")}`).toBe(true);
    }
  });
  it("rejects every fabricated op (zero false negatives)", async () => {
    for (const op of fabricatedOps) {
      const v = await mechanicalGuard(op, goldenEvidence, deps);
      expect(v.ok, `should have rejected ${op.type} / ${JSON.stringify(op).slice(0, 60)}`).toBe(false);
      expect(v.failures.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/guard/mechanical.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/guard/mechanical.ts`**

```ts
import type { Basis, EditOp, EvidenceSet, GuardVerdict } from "../types.js";
import { claimsOf } from "../types.js";
import { extractNumbers } from "../evidence/retriever.js";

export interface MechanicalDeps {
  currentBasis(procedureSlug: string, week: number, band: "low" | "typical" | "high"): Promise<Basis | null>;
}

function numbersBackedBySource(nums: number[], sourceUrl: string, ev: EvidenceSet): boolean {
  const allowed = new Set<number>();
  for (const f of ev.facts) if (f.sourceUrl === sourceUrl) for (const n of f.numbers) allowed.add(n);
  return nums.every((n) => allowed.has(n));
}

export async function mechanicalGuard(op: EditOp, ev: EvidenceSet, deps: MechanicalDeps): Promise<GuardVerdict> {
  const failures: string[] = [];

  // Rule 1: no invented source URLs anywhere.
  for (const c of claimsOf(op)) {
    if (!ev.knownSourceUrls.has(c.sourceUrl)) failures.push(`unknown sourceUrl: ${c.sourceUrl}`);
  }

  if (op.type === "replaceProse" || op.type === "updateMeta") {
    const text = op.type === "replaceProse" ? op.newText : op.value;
    const nums = extractNumbers(text);
    if (nums.length > 0) {
      // each number must be backed by at least one cited source in the claims
      const citedUrls = op.claims.map((c) => c.sourceUrl);
      const backed = nums.every((n) => citedUrls.some((u) => numbersBackedBySource([n], u, ev)));
      if (!backed) failures.push(`prose contains number(s) not backed by a cited fact: ${nums.join(", ")}`);
      if (op.claims.length === 0) failures.push("prose asserts numbers but carries no claims");
    }
  }

  if (op.type === "addSource") {
    if (!ev.knownSourceUrls.has(op.source.url)) failures.push(`addSource url not in evidence base: ${op.source.url}`);
  }

  if (op.type === "promoteToMeasured") {
    if (!ev.knownSourceUrls.has(op.sourceUrl)) failures.push(`promote sourceUrl unknown: ${op.sourceUrl}`);
    if (!numbersBackedBySource([op.value], op.sourceUrl, ev)) failures.push(`promote value ${op.value} not found in that source's facts`);
    const basis = await deps.currentBasis(op.procedureSlug, op.week, op.band);
    if (basis !== "interpolated") failures.push(`refusing to promote: current basis is ${basis}, not interpolated`);
  }

  return { op, ok: failures.length === 0, failures };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/guard/mechanical.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/guard/mechanical.ts src/guard/mechanical.test.ts && git commit -m "feat: mechanical grounding guard (Layer 1)"
```

---

### Task 11: Adversarial judge (Layer 2)

**Files:**
- Create: `src/guard/judge.ts`, `src/guard/judge.test.ts`

**Interfaces:**
- Consumes: `LlmClient`, `EvidenceSet`, a single prose claim.
- Produces: `judgeClaim(llm, claim, passage): Promise<{ supported: boolean; reason: string }>`. Parses a strict JSON reply `{ "supported": boolean, "reason": string }`; **any parse failure or missing field → `supported: false`** (default reject).

- [ ] **Step 1: Write the failing test (FakeLlm, no network)**

```ts
import { describe, it, expect } from "vitest";
import { judgeClaim } from "./judge.js";
import { FakeLlm } from "../llm/client.js";

describe("judgeClaim", () => {
  it("accepts a supported claim", async () => {
    const llm = new FakeLlm([JSON.stringify({ supported: true, reason: "passage states 87%" })]);
    const r = await judgeClaim(llm, "87% return to sport", "Memon: 87% returned to sport by 12 months");
    expect(r.supported).toBe(true);
  });
  it("defaults to reject on unparseable output", async () => {
    const llm = new FakeLlm(["I think it's fine, probably."]);
    const r = await judgeClaim(llm, "claim", "passage");
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/unparseable|reject/i);
  });
  it("rejects an unsupported claim", async () => {
    const llm = new FakeLlm([JSON.stringify({ supported: false, reason: "no such number in passage" })]);
    const r = await judgeClaim(llm, "95% return", "passage says 87%");
    expect(r.supported).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/guard/judge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/guard/judge.ts`**

```ts
import { z } from "zod";
import type { LlmClient } from "../llm/client.js";

const Verdict = z.object({ supported: z.boolean(), reason: z.string() });

const SYSTEM = [
  "You are an adversarial fact-checker for a medical (YMYL) content pipeline.",
  "You are given ONE claim and the cited source passage.",
  "Answer ONLY whether the passage directly supports the claim.",
  "Reply with STRICT JSON: {\"supported\": boolean, \"reason\": string}. No prose outside JSON.",
  "If the passage does not clearly and directly support the claim, set supported=false.",
  "When uncertain, default to supported=false.",
].join(" ");

export async function judgeClaim(llm: LlmClient, claim: string, passage: string): Promise<{ supported: boolean; reason: string }> {
  const user = `CLAIM:\n${claim}\n\nCITED PASSAGE:\n${passage}`;
  let raw: string;
  try {
    raw = await llm.complete({ system: SYSTEM, user, maxTokens: 300 });
  } catch (e) {
    return { supported: false, reason: `judge error, reject: ${(e as Error).message}` };
  }
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { supported: false, reason: "unparseable judge output, default reject" };
  const parsed = Verdict.safeParse(JSON.parse(match[0].replace(/[ -]+/g, " ")));
  if (!parsed.success) return { supported: false, reason: "unparseable judge output, default reject" };
  return parsed.data;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/guard/judge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/guard/judge.ts src/guard/judge.test.ts && git commit -m "feat: adversarial LLM judge (Layer 2), default-reject"
```

---

### Task 12: GroundingGuard (compose L1 + L2)

**Files:**
- Create: `src/guard/grounding-guard.ts`, `src/guard/grounding-guard.test.ts`

**Interfaces:**
- Consumes: `mechanicalGuard`, `judgeClaim`, `LlmClient`, `EvidenceSet`, `Draft`.
- Produces: `class GroundingGuard { check(draft: Draft, ev: EvidenceSet): Promise<GuardResult> }`. An op passes only if mechanical passes **and** every prose claim it carries is judged `supported`. Prose claims (`replaceProse`/`updateMeta`) go to the judge; `addSource`/`promoteToMeasured` are mechanical-only. Judge passage = the `claimText` of the evidence fact whose `sourceUrl` matches the claim (best match), else the raw claim text.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { GroundingGuard } from "./grounding-guard.js";
import { FakeLlm } from "../llm/client.js";
import { goldenEvidence, groundedOps, fabricatedOps } from "../../test/fixtures/evidence.js";

const deps = { currentBasis: async () => "interpolated" as const };

describe("GroundingGuard", () => {
  it("passes grounded ops when judge agrees", async () => {
    const llm = new FakeLlm([JSON.stringify({ supported: true, reason: "ok" })]); // one prose claim in groundedOps
    const guard = new GroundingGuard(llm, deps);
    const res = await guard.check({ ref: goldenEvidence.ref, ops: groundedOps, rationale: "" }, goldenEvidence);
    expect(res.allPassed).toBe(true);
    expect(res.passedOps.length).toBe(groundedOps.length);
  });
  it("drops a mechanically-fabricated op even if judge would accept", async () => {
    const llm = new FakeLlm([JSON.stringify({ supported: true, reason: "ok" }), JSON.stringify({ supported: true, reason: "ok" })]);
    const guard = new GroundingGuard(llm, deps);
    const res = await guard.check({ ref: goldenEvidence.ref, ops: fabricatedOps, rationale: "" }, goldenEvidence);
    expect(res.passedOps.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/guard/grounding-guard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/guard/grounding-guard.ts`**

```ts
import type { Draft, EvidenceSet, GuardResult, GuardVerdict } from "../types.js";
import type { LlmClient } from "../llm/client.js";
import { mechanicalGuard, type MechanicalDeps } from "./mechanical.js";
import { judgeClaim } from "./judge.js";

export class GroundingGuard {
  constructor(private llm: LlmClient, private deps: MechanicalDeps) {}

  async check(draft: Draft, ev: EvidenceSet): Promise<GuardResult> {
    const verdicts: GuardVerdict[] = [];

    for (const op of draft.ops) {
      const mech = await mechanicalGuard(op, ev, this.deps);
      if (!mech.ok) { verdicts.push(mech); continue; }

      const failures: string[] = [];
      if (op.type === "replaceProse" || op.type === "updateMeta") {
        const claims = op.type === "replaceProse" ? op.claims : op.claims;
        for (const c of claims) {
          const passage = ev.facts.find((f) => f.sourceUrl === c.sourceUrl)?.claimText ?? c.text;
          const v = await judgeClaim(this.llm, c.text, passage);
          if (!v.supported) failures.push(`judge rejected "${c.text}": ${v.reason}`);
        }
      }
      verdicts.push({ op, ok: failures.length === 0, failures });
    }

    const passedOps = verdicts.filter((v) => v.ok).map((v) => v.op);
    return { verdicts, passedOps, allPassed: passedOps.length === draft.ops.length };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/guard/grounding-guard.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/guard/grounding-guard.ts src/guard/grounding-guard.test.ts && git commit -m "feat: GroundingGuard composes mechanical + judge"
```

---

### Task 13: TargetSelector

**Files:**
- Create: `src/selector/target-selector.ts`, `src/selector/target-selector.test.ts`

**Interfaces:**
- Consumes: `PageRef[]`, `GscRow[]`, and per-page staleness inputs via `deps = { interpolatedCount(ref), sourceCount(ref), lastEditedAt(procedureSlug) }`.
- Produces: `class TargetSelector { rank(pages, gscByUrl, now): Promise<Candidate[]> }` and `pickOne(candidates): Candidate | null`. Score = weighted sum of: underperformance (position in 11..30 → high; ctr below expected for impressions) + staleness (interpolated bands, thin sources, age since last edit). Returns candidates sorted desc; reasons populated.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { TargetSelector } from "./target-selector.js";
import type { PageRef, GscRow } from "../types.js";

const pages: PageRef[] = [
  { procedureSlug: "a", urlSlug: "a", week: null, url: "https://s/a" },
  { procedureSlug: "b", urlSlug: "b", week: null, url: "https://s/b" },
];
const gsc: Record<string, GscRow> = {
  "https://s/a": { url: "https://s/a", clicks: 1, impressions: 500, ctr: 0.002, position: 18 }, // page 2, low ctr
  "https://s/b": { url: "https://s/b", clicks: 40, impressions: 500, ctr: 0.08, position: 3 },   // healthy
};
const now = 1_800_000_000_000;
const deps = {
  interpolatedCount: async (r: PageRef) => (r.procedureSlug === "a" ? 5 : 0),
  sourceCount: async (r: PageRef) => (r.procedureSlug === "a" ? 1 : 8),
  lastEditedAt: async (slug: string) => (slug === "a" ? now - 200 * 864e5 : now - 2 * 864e5),
};

describe("TargetSelector", () => {
  it("ranks the underperforming+stale page first", async () => {
    const sel = new TargetSelector(deps);
    const ranked = await sel.rank(pages, gsc, now);
    expect(ranked[0].ref.procedureSlug).toBe("a");
    expect(ranked[0].reasons.length).toBeGreaterThan(0);
  });
  it("pickOne returns the top candidate", async () => {
    const sel = new TargetSelector(deps);
    const top = sel.pickOne(await sel.rank(pages, gsc, now));
    expect(top?.ref.procedureSlug).toBe("a");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/selector/target-selector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/selector/target-selector.ts`**

```ts
import type { Candidate, GscRow, PageRef } from "../types.js";

export interface SelectorDeps {
  interpolatedCount(ref: PageRef): Promise<number>;
  sourceCount(ref: PageRef): Promise<number>;
  lastEditedAt(procedureSlug: string): Promise<number>;
}

const DAY = 864e5;

export class TargetSelector {
  constructor(private deps: SelectorDeps) {}

  async rank(pages: PageRef[], gscByUrl: Record<string, GscRow>, now: number): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    for (const ref of pages) {
      const gsc = gscByUrl[ref.url];
      const reasons: string[] = [];
      let score = 0;

      if (gsc) {
        if (gsc.position >= 11 && gsc.position <= 30) { score += 3; reasons.push(`page-2/3 position ${gsc.position.toFixed(1)}`); }
        if (gsc.impressions >= 100 && gsc.ctr < 0.02) { score += 2; reasons.push(`low CTR ${(gsc.ctr * 100).toFixed(1)}% on ${gsc.impressions} impressions`); }
      }
      const interp = await this.deps.interpolatedCount(ref);
      if (interp > 0) { score += Math.min(interp, 5) * 0.6; reasons.push(`${interp} interpolated band(s)`); }
      const sources = await this.deps.sourceCount(ref);
      if (sources <= 2) { score += 1.5; reasons.push(`thin sources (${sources})`); }
      const age = (now - (await this.deps.lastEditedAt(ref.procedureSlug))) / DAY;
      if (age > 90) { score += Math.min((age - 90) / 90, 2); reasons.push(`${Math.round(age)}d since last edit`); }

      candidates.push({ ref, score, reasons, gsc });
    }
    return candidates.sort((a, b) => b.score - a.score);
  }

  pickOne(candidates: Candidate[]): Candidate | null {
    return candidates.length && candidates[0].score > 0 ? candidates[0] : null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/selector/target-selector.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/selector/ && git commit -m "feat: TargetSelector (underperformance + staleness scoring)"
```

---

### Task 14: PerformanceSignal (GSC via seo-loop.mjs)

**Files:**
- Create: `src/performance/gsc.ts`, `src/performance/gsc.test.ts`

**Interfaces:**
- Consumes: `Config` (targetRepoPath, gscSaJson, gscProperty); an injectable `runner(cmd, args, opts)` so tests don't spawn a subprocess.
- Produces: `class PerformanceSignal { snapshot(): Promise<Record<string, GscRow>> }`. Spawns `node scripts/seo-loop.mjs --json` in the target repo with the GSC env vars, parses stdout JSON into `GscRow[]` keyed by full URL (`targetOrigin` + path).

> The exact JSON shape of `seo-loop.mjs` must be confirmed against the target on first real run; this task codes to a documented shape (`{ rows: [{ page, clicks, impressions, ctr, position }] }`) and the runner is injected so the parser is unit-tested against a captured fixture.

- [ ] **Step 1: Write the failing test (injected runner)**

```ts
import { describe, it, expect } from "vitest";
import { PerformanceSignal } from "./gsc.js";

const fakeJson = JSON.stringify({ rows: [
  { page: "/hip-arthroscopy-recovery-timeline", clicks: 2, impressions: 400, ctr: 0.005, position: 17.4 },
] });

describe("PerformanceSignal", () => {
  it("parses seo-loop JSON into GscRow keyed by absolute URL", async () => {
    const perf = new PerformanceSignal({
      targetRepoPath: "/tmp/steady", targetOrigin: "https://growsteady.me",
      gscSaJson: "/tmp/sa.json", gscProperty: "sc-domain:growsteady.me",
      runner: async () => ({ stdout: fakeJson, stderr: "" }),
    });
    const snap = await perf.snapshot();
    const row = snap["https://growsteady.me/hip-arthroscopy-recovery-timeline"];
    expect(row.position).toBeCloseTo(17.4);
    expect(row.impressions).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/performance/gsc.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/performance/gsc.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GscRow } from "../types.js";

const pexec = promisify(execFile);
type Runner = (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr: string }>;

export interface PerfOpts {
  targetRepoPath: string;
  targetOrigin: string;
  gscSaJson: string;
  gscProperty: string;
  runner?: Runner;
}

export class PerformanceSignal {
  private runner: Runner;
  constructor(private opts: PerfOpts) {
    this.runner = opts.runner ?? ((c, a, o) => pexec(c, a, o));
  }

  async snapshot(): Promise<Record<string, GscRow>> {
    const { stdout } = await this.runner("node", ["scripts/seo-loop.mjs", "--json"], {
      cwd: this.opts.targetRepoPath,
      env: { ...process.env, GSC_SA_JSON: this.opts.gscSaJson, GSC_PROPERTY: this.opts.gscProperty },
    });
    const data = JSON.parse(stdout) as { rows: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }> };
    const out: Record<string, GscRow> = {};
    for (const r of data.rows) {
      const url = r.page.startsWith("http") ? r.page : this.opts.targetOrigin + r.page;
      out[url] = { url, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position };
    }
    return out;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/performance/gsc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/performance/ && git commit -m "feat: PerformanceSignal wraps seo-loop.mjs JSON"
```

---

### Task 15: RefreshDrafter

**Files:**
- Create: `src/drafter/prompts.ts`, `src/drafter/refresh-drafter.ts`, `src/drafter/refresh-drafter.test.ts`

**Interfaces:**
- Consumes: `LlmClient`, `EvidenceSet`, `Candidate`, current `ReadContent`.
- Produces: `class RefreshDrafter { draft(candidate, content, ev): Promise<Draft> }`. Builds a prompt listing ONLY the allowed source URLs + facts, instructs the model to return `{ rationale, ops }` as strict JSON where every op conforms to `EditOp`, parses with a zod schema, and **drops any op referencing a `sourceUrl` not in `ev.knownSourceUrls` before returning** (belt-and-suspenders; the guard is the real gate). One retry on parse failure.

- [ ] **Step 1: Write `src/drafter/prompts.ts`**

```ts
import type { Candidate, EvidenceSet } from "../types.js";
import type { ReadContent } from "../content-source/index.js";

export const DRAFTER_SYSTEM = [
  "You maintain a medical (YMYL) recovery-timeline site. You may ONLY state facts that appear in the provided EVIDENCE.",
  "You cannot invent sources or numbers. Every numeric claim must cite a source URL from the ALLOWED SOURCES list.",
  "Return STRICT JSON only: { \"rationale\": string, \"ops\": EditOp[] }.",
  "EditOp is one of:",
  '  {"type":"replaceProse","procedureSlug","field","oldText","newText","claims":[{"text","sourceUrl"}]}',
  '  {"type":"addSource","procedureSlug","source":{"title","url","tier","reliabilityScore"}}',
  '  {"type":"updateMeta","procedureSlug","week":number|null,"field":"title"|"description","value","claims":[...]}',
  '  {"type":"promoteToMeasured","procedureSlug","week":number,"band":"low"|"typical"|"high","value":number,"sourceUrl","nativeScale"}',
  "Prefer 1-3 high-confidence ops. If nothing can be improved within the evidence, return an empty ops array.",
].join("\n");

export function drafterUser(candidate: Candidate, content: ReadContent, ev: EvidenceSet): string {
  const allowed = [...ev.knownSourceUrls].map((u) => `- ${u}`).join("\n");
  const facts = ev.facts.map((f) => `- (${f.sourceUrl}) ${f.claimText}`).join("\n");
  const prose = Object.entries(content.prose).map(([k, v]) => `[${k}] ${v}`).join("\n");
  return [
    `TARGET: ${candidate.ref.procedureSlug} (${candidate.ref.url})`,
    `WHY SELECTED: ${candidate.reasons.join("; ")}`,
    `\nALLOWED SOURCES:\n${allowed}`,
    `\nEVIDENCE FACTS:\n${facts}`,
    `\nCURRENT PROSE:\n${prose}`,
  ].join("\n");
}
```

- [ ] **Step 2: Write the failing test (FakeLlm)**

```ts
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/drafter/refresh-drafter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/drafter/refresh-drafter.ts`**

```ts
import { z } from "zod";
import type { Candidate, Draft, EditOp, EvidenceSet } from "../types.js";
import { claimsOf } from "../types.js";
import type { LlmClient } from "../llm/client.js";
import type { ReadContent } from "../content-source/index.js";
import { DRAFTER_SYSTEM, drafterUser } from "./prompts.js";

const SourceSchema = z.object({ title: z.string(), url: z.string(), tier: z.string(), reliabilityScore: z.number() });
const ClaimSchema = z.object({ text: z.string(), sourceUrl: z.string() });
const OpSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("replaceProse"), procedureSlug: z.string(), field: z.string(), oldText: z.string(), newText: z.string(), claims: z.array(ClaimSchema) }),
  z.object({ type: z.literal("addSource"), procedureSlug: z.string(), source: SourceSchema }),
  z.object({ type: z.literal("updateMeta"), procedureSlug: z.string(), week: z.number().nullable(), field: z.enum(["title", "description"]), value: z.string(), claims: z.array(ClaimSchema) }),
  z.object({ type: z.literal("promoteToMeasured"), procedureSlug: z.string(), week: z.number(), band: z.enum(["low", "typical", "high"]), value: z.number(), sourceUrl: z.string(), nativeScale: z.string() }),
]);
const ReplySchema = z.object({ rationale: z.string(), ops: z.array(OpSchema) });

export class RefreshDrafter {
  constructor(private llm: LlmClient) {}

  async draft(candidate: Candidate, content: ReadContent, ev: EvidenceSet): Promise<Draft> {
    const user = drafterUser(candidate, content, ev);
    let parsed = await this.tryOnce(user);
    if (!parsed) parsed = await this.tryOnce(user + "\n\nYour previous reply was not valid JSON. Reply with STRICT JSON only.");
    const ops: EditOp[] = (parsed?.ops ?? []).filter((op) => claimsOf(op).every((c) => ev.knownSourceUrls.has(c.sourceUrl)));
    return { ref: candidate.ref, ops, rationale: parsed?.rationale ?? "" };
  }

  private async tryOnce(user: string): Promise<{ rationale: string; ops: EditOp[] } | null> {
    const raw = await this.llm.complete({ system: DRAFTER_SYSTEM, user, maxTokens: 4096 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const p = ReplySchema.safeParse(JSON.parse(match[0]));
      return p.success ? (p.data as { rationale: string; ops: EditOp[] }) : null;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/drafter/refresh-drafter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/drafter/ && git commit -m "feat: RefreshDrafter (zod-validated EditOp[] with closed-world filter)"
```

---

### Task 16: BuildVerifier

**Files:**
- Create: `src/build/verifier.ts`, `src/build/verifier.test.ts`

**Interfaces:**
- Consumes: `Config.targetRepoPath`; injectable `runner`.
- Produces: `class BuildVerifier { verify(): Promise<{ ok: boolean; log: string }> }`. Runs a configurable list of commands (default `[["npx","tsc","--noEmit"]]`) in the target repo; first non-zero exit → `{ ok: false, log }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { BuildVerifier } from "./verifier.js";

describe("BuildVerifier", () => {
  it("ok when all commands succeed", async () => {
    const v = new BuildVerifier({ targetRepoPath: "/tmp/x", commands: [["true", []]], runner: async () => ({ stdout: "ok", stderr: "" }) });
    expect((await v.verify()).ok).toBe(true);
  });
  it("fails on non-zero exit", async () => {
    const v = new BuildVerifier({ targetRepoPath: "/tmp/x", commands: [["tsc", ["--noEmit"]]], runner: async () => { const e: any = new Error("type error"); e.stdout = "err TS2322"; throw e; } });
    const r = await v.verify();
    expect(r.ok).toBe(false);
    expect(r.log).toMatch(/TS2322/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/build/verifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/build/verifier.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);
type Runner = (cmd: string, args: string[], opts: { cwd: string }) => Promise<{ stdout: string; stderr: string }>;

export interface VerifierOpts {
  targetRepoPath: string;
  commands?: Array<[string, string[]]>;
  runner?: Runner;
}

export class BuildVerifier {
  private commands: Array<[string, string[]]>;
  private runner: Runner;
  constructor(private opts: VerifierOpts) {
    this.commands = opts.commands ?? [["npx", ["tsc", "--noEmit"]]];
    this.runner = opts.runner ?? ((c, a, o) => pexec(c, a, o));
  }
  async verify(): Promise<{ ok: boolean; log: string }> {
    let log = "";
    for (const [cmd, args] of this.commands) {
      try {
        const { stdout, stderr } = await this.runner(cmd, args, { cwd: this.opts.targetRepoPath });
        log += `$ ${cmd} ${args.join(" ")}\n${stdout}${stderr}\n`;
      } catch (e: any) {
        log += `$ ${cmd} ${args.join(" ")}\n${e.stdout ?? ""}${e.stderr ?? ""}${e.message}\n`;
        return { ok: false, log };
      }
    }
    return { ok: true, log };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/build/verifier.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/build/ && git commit -m "feat: BuildVerifier runs target typecheck/tests"
```

---

### Task 17: PRWriter

**Files:**
- Create: `src/pr/pr-writer.ts`, `src/pr/pr-writer.test.ts`

**Interfaces:**
- Consumes: `Config` (targetRepoPath, baseBranch), passed `EditOp[]` + `EvidenceSet`; injectable `runner` for `git`/`gh`.
- Produces: `class PRWriter`: `startBranch(ref): Promise<string>` (creates `groundskeeper/<slug>-<ts>` off base), `finalize(ref, ops, ev): Promise<string>` (git add/commit/push, `gh pr create` with an audit-table body), `abort(branch): Promise<void>` (checkout base, delete branch). `buildAuditTable(ops, ev): string` is pure and unit-tested.

- [ ] **Step 1: Write the failing test (pure audit table + injected runner)**

```ts
import { describe, it, expect } from "vitest";
import { PRWriter } from "./pr-writer.js";
import { goldenEvidence, groundedOps } from "../../test/fixtures/evidence.js";

describe("PRWriter", () => {
  it("builds a claim→source audit table", () => {
    const w = new PRWriter({ targetRepoPath: "/tmp/s", baseBranch: "main", runner: async () => ({ stdout: "", stderr: "" }) });
    const md = w.buildAuditTable(groundedOps, goldenEvidence);
    expect(md).toContain("| Change | Claim | Source |");
    expect(md).toContain("PMC8530429");
  });
  it("startBranch issues git checkout -b off base", async () => {
    const calls: string[][] = [];
    const w = new PRWriter({ targetRepoPath: "/tmp/s", baseBranch: "main", runner: async (c, a) => { calls.push([c, ...a]); return { stdout: "", stderr: "" }; } });
    const branch = await w.startBranch(goldenEvidence.ref);
    expect(branch).toMatch(/^groundskeeper\/hip-arthroscopy-fai-/);
    expect(calls.some((c) => c[0] === "git" && c.includes("checkout") && c.includes("main"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/pr/pr-writer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/pr/pr-writer.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EditOp, EvidenceSet, PageRef } from "../types.js";
import { claimsOf } from "../types.js";

const pexec = promisify(execFile);
type Runner = (cmd: string, args: string[], opts: { cwd: string }) => Promise<{ stdout: string; stderr: string }>;

export interface PRWriterOpts {
  targetRepoPath: string;
  baseBranch: string;
  runner?: Runner;
}

export class PRWriter {
  private runner: Runner;
  constructor(private opts: PRWriterOpts) {
    this.runner = opts.runner ?? ((c, a, o) => pexec(c, a, o));
  }
  private git(args: string[]) { return this.runner("git", args, { cwd: this.opts.targetRepoPath }); }

  async startBranch(ref: PageRef): Promise<string> {
    const branch = `groundskeeper/${ref.procedureSlug}-${Date.now()}`;
    await this.git(["fetch", "origin", this.opts.baseBranch]);
    await this.git(["checkout", "-B", branch, this.opts.baseBranch]);
    return branch;
  }

  buildAuditTable(ops: EditOp[], ev: EvidenceSet): string {
    const rows = ops.flatMap((op) =>
      claimsOf(op).map((c) => {
        const title = ev.facts.find((f) => f.sourceUrl === c.sourceUrl)?.sourceTitle ?? c.sourceUrl;
        return `| ${op.type} | ${c.text} | [${title}](${c.sourceUrl}) |`;
      })
    );
    return ["| Change | Claim | Source |", "| --- | --- | --- |", ...rows].join("\n");
  }

  async finalize(ref: PageRef, ops: EditOp[], ev: EvidenceSet): Promise<string> {
    const branch = (await this.git(["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    await this.git(["add", "-A"]);
    await this.git(["commit", "-m", `content: refresh ${ref.procedureSlug}\n\nAutomated grounded refresh (groundskeeper).`]);
    await this.git(["push", "-u", "origin", branch]);
    const body = [
      `Automated grounded refresh of \`${ref.procedureSlug}\`.`,
      ``,
      `Every claim below traces to a source already in the evidence base.`,
      ``,
      this.buildAuditTable(ops, ev),
    ].join("\n");
    const { stdout } = await this.runner("gh", ["pr", "create", "--base", this.opts.baseBranch, "--head", branch, "--title", `Refresh: ${ref.procedureSlug}`, "--body", body], { cwd: this.opts.targetRepoPath });
    return stdout.trim();
  }

  async abort(branch: string): Promise<void> {
    await this.git(["checkout", this.opts.baseBranch]);
    await this.git(["branch", "-D", branch]);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/pr/pr-writer.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pr/ && git commit -m "feat: PRWriter (branch/commit/push/gh pr + audit table)"
```

---

### Task 18: Orchestrator

**Files:**
- Create: `src/orchestrator.ts`, `src/orchestrator.test.ts`

**Interfaces:**
- Consumes: every component above via a `Deps` object (dependency injection for testing).
- Produces: `class Orchestrator { runOnce(opts: { dryRun: boolean }): Promise<RunResult> }` where `RunResult = { status: "no-target" | "nothing-passed" | "build-failed" | "dry-run" | "pr-opened"; detail: string; passedOps: EditOp[] }`. Flow: snapshot → rank → pickOne → retrieve → draft → guard → (if dryRun: return audit) → startBranch → applyOps → verify → (fail: abort) → finalize.

- [ ] **Step 1: Write the failing test (all deps faked)**

```ts
import { describe, it, expect } from "vitest";
import { Orchestrator } from "./orchestrator.js";
import { goldenEvidence, groundedOps } from "../test/fixtures/evidence.js";

function baseDeps(overrides = {}) {
  return {
    performance: { snapshot: async () => ({ [goldenEvidence.ref.url]: { url: goldenEvidence.ref.url, clicks: 1, impressions: 400, ctr: 0.004, position: 18 } }) },
    contentSource: {
      listPages: async () => [goldenEvidence.ref],
      readContent: async () => ({ prose: { outlook: "Most return within a year." }, sources: goldenEvidence.sources }),
      applyOps: async () => {},
    },
    selector: { rank: async () => [{ ref: goldenEvidence.ref, score: 5, reasons: ["page-2"] }], pickOne: (c: any[]) => c[0] ?? null },
    retriever: { retrieve: async () => goldenEvidence },
    drafter: { draft: async () => ({ ref: goldenEvidence.ref, ops: groundedOps, rationale: "r" }) },
    guard: { check: async () => ({ verdicts: [], passedOps: groundedOps, allPassed: true }) },
    build: { verify: async () => ({ ok: true, log: "ok" }) },
    pr: { startBranch: async () => "groundskeeper/x", finalize: async () => "https://github.com/pr/1", abort: async () => {} },
    now: () => 1_800_000_000_000,
    ...overrides,
  } as any;
}

describe("Orchestrator", () => {
  it("dry-run returns audit without opening a PR", async () => {
    const deps = baseDeps();
    const o = new Orchestrator(deps);
    const r = await o.runOnce({ dryRun: true });
    expect(r.status).toBe("dry-run");
    expect(r.passedOps.length).toBe(groundedOps.length);
  });
  it("opens a PR on a full run", async () => {
    const o = new Orchestrator(baseDeps());
    const r = await o.runOnce({ dryRun: false });
    expect(r.status).toBe("pr-opened");
    expect(r.detail).toContain("github.com/pr/1");
  });
  it("aborts and reports when build fails", async () => {
    let aborted = false;
    const o = new Orchestrator(baseDeps({ build: { verify: async () => ({ ok: false, log: "TS2322" }) }, pr: { startBranch: async () => "b", finalize: async () => "x", abort: async () => { aborted = true; } } }));
    const r = await o.runOnce({ dryRun: false });
    expect(r.status).toBe("build-failed");
    expect(aborted).toBe(true);
  });
  it("reports no-target when selector picks nothing", async () => {
    const o = new Orchestrator(baseDeps({ selector: { rank: async () => [], pickOne: () => null } }));
    expect((await o.runOnce({ dryRun: false })).status).toBe("no-target");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/orchestrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/orchestrator.ts`**

```ts
import type { EditOp, EvidenceSet, GscRow, Candidate, Draft, GuardResult, PageRef } from "./types.js";
import type { ReadContent } from "./content-source/index.js";

export interface OrchestratorDeps {
  performance: { snapshot(): Promise<Record<string, GscRow>> };
  contentSource: { listPages(): Promise<PageRef[]>; readContent(ref: PageRef): Promise<ReadContent>; applyOps(ops: EditOp[]): Promise<void> };
  selector: { rank(pages: PageRef[], gsc: Record<string, GscRow>, now: number): Promise<Candidate[]>; pickOne(c: Candidate[]): Candidate | null };
  retriever: { retrieve(ref: PageRef): Promise<EvidenceSet> };
  drafter: { draft(c: Candidate, content: ReadContent, ev: EvidenceSet): Promise<Draft> };
  guard: { check(d: Draft, ev: EvidenceSet): Promise<GuardResult> };
  build: { verify(): Promise<{ ok: boolean; log: string }> };
  pr: { startBranch(ref: PageRef): Promise<string>; finalize(ref: PageRef, ops: EditOp[], ev: EvidenceSet): Promise<string>; abort(branch: string): Promise<void> };
  now: () => number;
}

export interface RunResult {
  status: "no-target" | "nothing-passed" | "build-failed" | "dry-run" | "pr-opened";
  detail: string;
  passedOps: EditOp[];
}

export class Orchestrator {
  constructor(private d: OrchestratorDeps) {}

  async runOnce(opts: { dryRun: boolean }): Promise<RunResult> {
    const gsc = await this.d.performance.snapshot();
    const pages = await this.d.contentSource.listPages();
    const candidate = this.d.selector.pickOne(await this.d.selector.rank(pages, gsc, this.d.now()));
    if (!candidate) return { status: "no-target", detail: "no page scored above zero", passedOps: [] };

    const ev = await this.d.retriever.retrieve(candidate.ref);
    const content = await this.d.contentSource.readContent(candidate.ref);
    const draft = await this.d.drafter.draft(candidate, content, ev);
    const guard = await this.d.guard.check(draft, ev);
    if (guard.passedOps.length === 0) return { status: "nothing-passed", detail: "guard rejected all ops", passedOps: [] };

    if (opts.dryRun) return { status: "dry-run", detail: `${guard.passedOps.length} op(s) would ship for ${candidate.ref.procedureSlug}`, passedOps: guard.passedOps };

    const branch = await this.d.pr.startBranch(candidate.ref);
    await this.d.contentSource.applyOps(guard.passedOps);
    const build = await this.d.build.verify();
    if (!build.ok) {
      await this.d.pr.abort(branch);
      return { status: "build-failed", detail: build.log.slice(0, 500), passedOps: guard.passedOps };
    }
    const prUrl = await this.d.pr.finalize(candidate.ref, guard.passedOps, ev);
    return { status: "pr-opened", detail: prUrl, passedOps: guard.passedOps };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/orchestrator.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts src/orchestrator.test.ts && git commit -m "feat: Orchestrator one-cycle flow (dry-run, abort-on-build-fail)"
```

---

### Task 19: CLI wiring + end-to-end smoke

**Files:**
- Create: `src/cli.ts`, `src/cli.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, all concrete components, `Orchestrator`.
- Produces: `buildOrchestrator(config): Orchestrator` (wires real deps) and a `main(argv)` that parses `--dry-run` and prints `RunResult`. `buildOrchestrator` is unit-tested for wiring; real GSC/LLM/gh only run when invoked manually.

- [ ] **Step 1: Write the failing wiring test**

```ts
import { describe, it, expect } from "vitest";
import { buildOrchestrator } from "./cli.js";

describe("buildOrchestrator", () => {
  it("wires an Orchestrator from config without touching the network", () => {
    const o = buildOrchestrator({
      targetRepoPath: "/tmp/steady", targetOrigin: "https://growsteady.me",
      gscSaJson: "/tmp/sa.json", gscProperty: "sc-domain:growsteady.me",
      anthropicApiKey: "sk-ant-x", model: "claude-sonnet-4-6", baseBranch: "main",
    });
    expect(o).toBeTruthy();
    expect(typeof (o as any).runOnce).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/cli.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/cli.ts`**

```ts
import "dotenv/config";
import { loadConfig, type Config } from "./config.js";
import { AnthropicClient } from "./llm/client.js";
import { SteadyContentSource } from "./content-source/steady.js";
import { PerformanceSignal } from "./performance/gsc.js";
import { TargetSelector } from "./selector/target-selector.js";
import { EvidenceRetriever } from "./evidence/retriever.js";
import { RefreshDrafter } from "./drafter/refresh-drafter.js";
import { GroundingGuard } from "./guard/grounding-guard.js";
import { BuildVerifier } from "./build/verifier.js";
import { PRWriter } from "./pr/pr-writer.js";
import { Orchestrator } from "./orchestrator.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PageRef } from "./types.js";

export function buildOrchestrator(config: Config): Orchestrator {
  const llm = new AnthropicClient(config.anthropicApiKey, config.model);
  const cs = new SteadyContentSource({ repoPath: config.targetRepoPath });

  const retriever = new EvidenceRetriever({
    readContent: (ref) => cs.readContent(ref),
    loadCurvePoints: async (slug) => {
      const mod = await import(`file://${join(config.targetRepoPath, "lib/benchmarks/curves/index.ts")}`).catch(() => ({}));
      const curve = (Object.values(mod as any).flat() as any[]).find?.((c) => c?.slug === slug);
      return curve?.points ?? [];
    },
    readDossier: async (slug) => readFile(join(config.targetRepoPath, "docs/benchmarks/recovery-data-sources.md"), "utf8").catch(() => ""),
  });

  const selector = new TargetSelector({
    interpolatedCount: async () => 0, // wired concretely against curves in a follow-up; 0 keeps selection GSC-driven
    sourceCount: async (ref) => (await cs.readContent(ref)).sources.length,
    lastEditedAt: (slug) => cs.lastEditedAt(slug),
  });

  return new Orchestrator({
    performance: new PerformanceSignal({ targetRepoPath: config.targetRepoPath, targetOrigin: config.targetOrigin, gscSaJson: config.gscSaJson, gscProperty: config.gscProperty }),
    contentSource: cs,
    selector,
    retriever,
    drafter: new RefreshDrafter(llm),
    guard: new GroundingGuard(llm, { currentBasis: (s, w, b) => cs.currentBasis(s, w, b) }),
    build: new BuildVerifier({ targetRepoPath: config.targetRepoPath }),
    pr: new PRWriter({ targetRepoPath: config.targetRepoPath, baseBranch: config.baseBranch }),
    now: () => Date.now(),
  });
}

export async function main(argv: string[]): Promise<void> {
  const dryRun = argv.includes("--dry-run");
  const o = buildOrchestrator(loadConfig());
  const result = await o.runOnce({ dryRun });
  console.log(JSON.stringify(result, null, 2));
}

// Only run when executed directly.
if (process.argv[1] && process.argv[1].endsWith("cli.js")) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `npm test && npm run build`
Expected: all tests pass; `dist/` builds clean.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/cli.test.ts && git commit -m "feat: CLI wiring + buildOrchestrator + dry-run"
```

---

### Task 20: Live dry-run acceptance on Steady (manual gate)

**Files:**
- Create: `docs/RUNBOOK.md`

**Interfaces:**
- Consumes: the full CLI against the real Steady checkout.
- Produces: a documented manual acceptance run — the MVP success gate.

- [ ] **Step 1: Confirm `seo-loop.mjs` JSON shape**

Run: `cd $TARGET_REPO_PATH && node scripts/seo-loop.mjs --json | head -c 800`
Expected: JSON. If the shape differs from `{ rows: [{ page, clicks, impressions, ctr, position }] }`, update `src/performance/gsc.ts` parser + its test, then `npx vitest run src/performance/gsc.test.ts`.

- [ ] **Step 2: Point config at the real modules**

In `src/content-source/steady.ts` construction (cli.ts), set `contentModules`/`curveModules` to Steady's real index files (`lib/benchmarks/content/index.ts`, `lib/benchmarks/curves/index.ts`) if they aggregate procedures; adjust `allContent()`/`allCurves()` to iterate the aggregated arrays. Re-run adapter tests against a copied fixture that mirrors the real shape.

- [ ] **Step 3: Dry run**

Run: `npm run build && node dist/cli.js --dry-run`
Expected: JSON `RunResult` with `status: "dry-run"` and 1–3 `passedOps`, or `no-target`/`nothing-passed`. No branch created, no PR.

- [ ] **Step 4: Manual grounding audit (the pass/fail bar)**

For each op in `passedOps`, confirm every claim's `sourceUrl` exists in Steady's `sources[]`/dossier and the claim is actually supported. **Zero ungrounded claims is required to pass.** Record the audit in `docs/RUNBOOK.md`.

- [ ] **Step 5: One real PR**

Run: `node dist/cli.js` (no `--dry-run`)
Expected: `status: "pr-opened"` with a PR URL; the PR body shows the claim→source audit table; the target build passed. Review the PR yourself — it is the acceptance test.

- [ ] **Step 6: Commit the runbook**

```bash
git add docs/RUNBOOK.md && git commit -m "docs: runbook + live acceptance results"
```

---

## Self-Review

**Spec coverage:**
- Closed-world rule → mechanical guard (Task 10) + drafter filter (Task 15) + evidence union (Task 8). ✓
- Maintain/refresh existing pages → EditOp set + Steady write adapter (Tasks 2, 7). ✓
- Trigger: underperformance + staleness → TargetSelector (Task 13). ✓
- Curated evidence base only → EvidenceRetriever + `knownSourceUrls` (Task 8). ✓
- ContentSource adapter seam → interface + Steady impl (Tasks 5–7). ✓
- Performance via seo-loop.mjs → PerformanceSignal (Task 14). ✓
- Two-layer guard → mechanical + judge + compose (Tasks 10–12). ✓
- BuildVerifier gate → Task 16. ✓
- PR with claim→source audit table → PRWriter (Task 17). ✓
- Human-approval, no auto-merge → PRWriter opens PR only; no merge step. ✓
- One target per run → selector `pickOne` + orchestrator (Tasks 13, 18). ✓
- Dry-run mode → Orchestrator + CLI (Tasks 18–19). ✓
- Success criteria (zero ungrounded / unattended / useful) → Task 20 acceptance gate + guard golden tests (Task 10). ✓
- Testing strategy (golden set, dry-run, one E2E PR) → Tasks 9, 18, 20. ✓

**Placeholder scan:** No TBD/TODO in code steps; every code step shows complete code. The two documented shape-assumptions (`seo-loop.mjs` JSON, real module aggregation) are explicitly resolved in Task 20 steps 1–2, not left vague.

**Type consistency:** `EditOp`, `ClaimRef`, `EvidenceSet`, `GuardResult`, `Candidate`, `PageRef`, `claimsOf`, `extractNumbers`, `LlmClient`, `ContentSource` names are used identically across all tasks. `currentBasis(procedureSlug, week, band)` signature matches between `ContentSource` (Task 5), mechanical guard deps (Task 10), grounding-guard (Task 12), and cli wiring (Task 19).

**Known follow-ups (out of MVP, logged not silently dropped):** `interpolatedCount` is stubbed to `0` in cli wiring (Task 19) so early selection is GSC-driven; wiring it to real curve parsing is a fast follow. `updateMeta` assumes a `meta` object in the content module — verify against Steady's real structure in Task 20 step 2.
