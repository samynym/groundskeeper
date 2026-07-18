import OpenAI from "openai";
import type { GeoAnswer, GeoEngineClient } from "./geo-engine.js";

/**
 * The one SDK call this adapter depends on, made injectable so the parsing is
 * unit-tested with no network. Typed loosely (params/return as `unknown`-ish)
 * on purpose: the Responses API surface is read defensively below via property
 * checks, so an SDK type bump can't break parsing or force a type chase.
 */
export type ResponsesCreate = (params: {
  model: string;
  tools: Array<Record<string, unknown>>;
  input: string;
}) => Promise<Record<string, unknown>>;

export interface OpenAiSearchOpts {
  model: string;
}

/**
 * A real GEO engine backed by ChatGPT (OpenAI Responses API) with the
 * web_search tool.
 *
 * GEO citation = the URLs the ANSWER attributes claims to, i.e. the
 * `url_citation` annotations on the output_text parts — NOT the broader
 * retrieval set. The Responses web-search does not expose the full retrieval
 * set, so retrievedUrls is always null (cannot report), never [].
 *
 * Fails safe: any API error yields {ok:false}, which snapshotGeo excludes from
 * the denominator (no data, not "not cited").
 */
export class OpenAiSearchEngine implements GeoEngineClient {
  readonly name = "openai-search";
  constructor(private create: ResponsesCreate, private opts: OpenAiSearchOpts) {}

  async ask(question: string): Promise<GeoAnswer> {
    try {
      const res = await this.create({
        model: this.opts.model,
        tools: [{ type: "web_search_preview" }],
        input: question,
      });
      // Read everything defensively via property checks so an SDK type bump
      // can't break parsing. `res.output` is the array of output items.
      const output = Array.isArray(res.output)
        ? (res.output as Array<Record<string, unknown>>)
        : [];
      let answerText = "";
      const urls: string[] = [];
      let sawToolUse = false;
      const queries: string[] = [];
      for (const item of output) {
        if (item.type === "message") {
          // content parts of type output_text carry the text + citation annotations.
          const parts = Array.isArray(item.content)
            ? (item.content as Array<Record<string, unknown>>)
            : [];
          for (const part of parts) {
            if (part.type !== "output_text") continue;
            if (typeof part.text === "string") answerText += part.text;
            const annotations = Array.isArray(part.annotations)
              ? (part.annotations as Array<Record<string, unknown>>)
              : [];
            for (const ann of annotations) {
              if (ann.type === "url_citation" && typeof ann.url === "string") urls.push(ann.url);
            }
          }
        } else if (item.type === "web_search_call") {
          sawToolUse = true;
          // Issued query lives at item.action.query when action.type === "search".
          const action = item.action as Record<string, unknown> | undefined;
          if (action && action.type === "search" && typeof action.query === "string") {
            queries.push(action.query);
          }
        }
      }
      // Guard: keep only absolute URLs (scheme + host). url_citation is already
      // absolute, but citation detection is host-based and treats a scheme-less
      // string as not cited, so drop anything that doesn't parse as such.
      const absolute = urls.filter(isAbsoluteUrl);
      return {
        answerText,
        citedUrls: [...new Set(absolute)],
        retrievedUrls: null, // Responses web-search never exposes the retrieval set.
        engineQueries: sawToolUse ? queries : null,
        ok: true,
      };
    } catch {
      return { answerText: "", citedUrls: [], retrievedUrls: null, engineQueries: null, ok: false };
    }
  }
}

/** True only for absolute URLs (scheme + host), matching host-based citation detection. */
function isAbsoluteUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol !== "" && u.host !== "";
  } catch {
    return false;
  }
}

/** Builds the create fn from a key. `new OpenAI()` makes no network call. */
export function openaiCreate(apiKey: string): ResponsesCreate {
  const client = new OpenAI({ apiKey });
  return (params) =>
    client.responses.create(params as never) as unknown as Promise<Record<string, unknown>>;
}
