import Anthropic from "@anthropic-ai/sdk";
import type { GeoAnswer, GeoEngineClient } from "./geo-engine.js";
import { OpenAiSearchEngine, openaiCreate } from "./openai-search-engine.js";

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
 * Credential-gated real engines, selectable via GEO_ENGINE. No key -> [] ->
 * GEO stays empty rather than fabricated.
 *
 * GEO_ENGINE (lowercased) picks the backend:
 *   "openai" -> ChatGPT/OpenAI-search only (if its key present)
 *   "claude" -> Claude-search only (if its key present)
 *   "both"   -> every engine whose key is present
 *   unset    -> auto: prefer OpenAI when its key is present (so "try ChatGPT
 *               first" is just a matter of providing the OpenAI key); else
 *               fall back to Claude when the Anthropic key is present.
 *
 * OpenAI key = OPENAI_API_KEY ?? GEO_ENGINE_OPENAI_KEY.
 * Anthropic key = ANTHROPIC_API_KEY ?? GEO_ENGINE_API_KEY. The *_ENGINE_*
 * fallbacks exist for cloud environments (e.g. claude.ai routines) that
 * reserve the provider-native name for the agent's own auth and strip it from
 * the process env — set the non-reserved name there instead.
 */
export function buildEngines(env: NodeJS.ProcessEnv): GeoEngineClient[] {
  const openaiKey = env.OPENAI_API_KEY ?? env.GEO_ENGINE_OPENAI_KEY;
  const claudeKey = env.ANTHROPIC_API_KEY ?? env.GEO_ENGINE_API_KEY;
  const openaiModel = env.GEO_ENGINE_OPENAI_MODEL ?? "gpt-4o";
  const claudeModel = env.GEO_ENGINE_MODEL ?? "claude-sonnet-4-6";
  const mkOpenai = () => new OpenAiSearchEngine(openaiCreate(openaiKey!), { model: openaiModel });
  const mkClaude = () => new ClaudeSearchEngine(anthropicCreate(claudeKey!), { model: claudeModel });

  const selection = (env.GEO_ENGINE ?? "").toLowerCase();
  if (selection === "openai") return openaiKey ? [mkOpenai()] : [];
  if (selection === "claude") return claudeKey ? [mkClaude()] : [];
  if (selection === "both") {
    const engines: GeoEngineClient[] = [];
    if (openaiKey) engines.push(mkOpenai());
    if (claudeKey) engines.push(mkClaude());
    return engines;
  }
  // Auto: prefer OpenAI, then fall back to Claude.
  if (openaiKey) return [mkOpenai()];
  if (claudeKey) return [mkClaude()];
  return [];
}
