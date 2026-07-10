import Anthropic from "@anthropic-ai/sdk";
import type { GeoAnswer, GeoEngineClient } from "./geo-engine.js";

/**
 * The one SDK call this adapter depends on, narrowed to the non-streaming
 * overload and made injectable so the parsing is unit-tested with no network.
 */
export type MessagesCreate = (
  params: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Message>;

export interface ClaudeSearchOpts {
  model: string;
  /** Max web searches the model may run per question. */
  maxUses?: number;
  maxTokens?: number;
}

/**
 * A real GEO engine backed by Claude with the web-search server tool.
 *
 * GEO citation = the URLs the ANSWER attributes claims to, i.e. the text
 * blocks' `web_search_result_location` citations — NOT the broader retrieval
 * set. If the answer cites nothing, citedUrls is [] and that is the honest
 * result (the engine did not cite you), never a fabricated hit.
 *
 * Fails safe: any API error yields {ok:false}, which snapshotGeo excludes
 * from the denominator (no data, not "not cited").
 */
export class ClaudeSearchEngine implements GeoEngineClient {
  readonly name = "claude-search";
  constructor(private create: MessagesCreate, private opts: ClaudeSearchOpts) {}

  async ask(question: string): Promise<GeoAnswer> {
    try {
      const res = await this.create({
        model: this.opts.model,
        max_tokens: this.opts.maxTokens ?? 2048,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: this.opts.maxUses ?? 5 }],
        messages: [{ role: "user", content: question }],
      });
      const textBlocks = (res.content ?? []).filter(
        (b): b is Anthropic.TextBlock => b.type === "text",
      );
      const answerText = textBlocks.map((b) => b.text).join("");
      const urls: string[] = [];
      for (const b of textBlocks) {
        for (const c of b.citations ?? []) {
          if (c.type === "web_search_result_location" && typeof c.url === "string") urls.push(c.url);
        }
      }
      // Retrieval set + issued queries: read defensively via property checks so an
      // SDK type bump can't break parsing. null = the block type never appeared.
      let sawResults = false;
      const retrieved: string[] = [];
      let sawToolUse = false;
      const queries: string[] = [];
      for (const raw of (res.content ?? []) as unknown as Array<Record<string, unknown>>) {
        if (raw.type === "web_search_tool_result") {
          sawResults = true;
          if (Array.isArray(raw.content)) {
            for (const r of raw.content as Array<Record<string, unknown>>) {
              if (r.type === "web_search_result" && typeof r.url === "string") retrieved.push(r.url);
            }
          }
        } else if (raw.type === "server_tool_use") {
          sawToolUse = true;
          const input = raw.input as Record<string, unknown> | undefined;
          if (input && typeof input.query === "string") queries.push(input.query);
        }
      }
      return {
        answerText,
        citedUrls: [...new Set(urls)],
        retrievedUrls: sawResults ? [...new Set(retrieved)] : null,
        engineQueries: sawToolUse ? queries : null,
        ok: true,
      };
    } catch {
      return { answerText: "", citedUrls: [], retrievedUrls: null, engineQueries: null, ok: false };
    }
  }
}

/** Builds the create fn from a key. `new Anthropic()` makes no network call. */
export function anthropicCreate(apiKey: string): MessagesCreate {
  const client = new Anthropic({ apiKey });
  return (params) => client.messages.create(params);
}

/**
 * Credential-gated real engines. Only the ANTHROPIC-backed Claude-search
 * engine is wired today (the only key we have); Perplexity / OpenAI-search
 * are follow-ons behind their own keys. No key -> [] -> GEO stays empty
 * rather than fabricated.
 */
export function buildEngines(env: NodeJS.ProcessEnv): GeoEngineClient[] {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return [];
  const model = env.GEO_ENGINE_MODEL ?? "claude-sonnet-4-6";
  return [new ClaudeSearchEngine(anthropicCreate(key), { model })];
}
