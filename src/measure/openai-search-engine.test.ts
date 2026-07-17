import { describe, it, expect } from "vitest";
import { OpenAiSearchEngine, type ResponsesCreate } from "./openai-search-engine.js";
import { buildEngines } from "./claude-search-engine.js";

// Responses-API-shaped fixture (fields we read: output[].{type,content,action}).
const res = (output: unknown[]): Record<string, unknown> => ({ output });

const urlCite = (url: string) => ({ type: "url_citation", url, title: "t", start_index: 0, end_index: 1 });

describe("OpenAiSearchEngine", () => {
  it("concatenates output_text and maps url_citation annotations to deduped citedUrls", async () => {
    const create: ResponsesCreate = async () =>
      res([
        { type: "web_search_call", id: "ws1", status: "completed", action: { type: "search", query: "acl recovery site:growsteady.me" } },
        { type: "message", role: "assistant", content: [
          { type: "output_text", text: "ACL recovery ", annotations: [urlCite("https://growsteady.me/acl-recovery-timeline")] },
          { type: "output_text", text: "takes months.", annotations: [
            urlCite("https://growsteady.me/acl-recovery-timeline"), // dupe
            urlCite("https://mayoclinic.org/acl"),
          ] },
        ] },
      ]);
    const eng = new OpenAiSearchEngine(create, { model: "gpt-4o" });
    const a = await eng.ask("how long does acl surgery recovery take");
    expect(a.ok).toBe(true);
    expect(a.answerText).toBe("ACL recovery takes months.");
    expect(a.citedUrls).toEqual([
      "https://growsteady.me/acl-recovery-timeline",
      "https://mayoclinic.org/acl",
    ]);
    expect(a.retrievedUrls).toBeNull();
    expect(a.engineQueries).toEqual(["acl recovery site:growsteady.me"]);
  });

  it("drops scheme-less citations (host-based detection treats them as not cited)", async () => {
    const create: ResponsesCreate = async () =>
      res([
        { type: "message", role: "assistant", content: [
          { type: "output_text", text: "answer", annotations: [
            urlCite("growsteady.me/no-scheme"), // no scheme+host -> dropped
            urlCite("https://hss.edu/acl"),
          ] },
        ] },
      ]);
    const a = await new OpenAiSearchEngine(create, { model: "m" }).ask("q");
    expect(a.citedUrls).toEqual(["https://hss.edu/acl"]);
  });

  it("returns engineQueries: null when no web_search_call appeared", async () => {
    const create: ResponsesCreate = async () =>
      res([
        { type: "message", role: "assistant", content: [
          { type: "output_text", text: "no search ran", annotations: [] },
        ] },
      ]);
    const a = await new OpenAiSearchEngine(create, { model: "m" }).ask("q");
    expect(a.answerText).toBe("no search ran");
    expect(a.citedUrls).toEqual([]);
    expect(a.retrievedUrls).toBeNull();
    expect(a.engineQueries).toBeNull();
  });

  it("fails safe (ok:false) when the API call throws", async () => {
    const create: ResponsesCreate = async () => { throw new Error("429 rate limited"); };
    const a = await new OpenAiSearchEngine(create, { model: "m" }).ask("q");
    expect(a).toEqual({ answerText: "", citedUrls: [], retrievedUrls: null, engineQueries: null, ok: false });
  });

  it("names itself openai-search for per-engine attribution", () => {
    expect(new OpenAiSearchEngine(async () => res([]), { model: "m" }).name).toBe("openai-search");
  });
});

describe("buildEngines selection", () => {
  it("wires a single openai-search engine when OPENAI_API_KEY is present", () => {
    const engines = buildEngines({ OPENAI_API_KEY: "sk-o" } as unknown as NodeJS.ProcessEnv);
    expect(engines.map((e) => e.name)).toEqual(["openai-search"]);
  });
  it("auto-prefers OpenAI over Claude when both keys are present", () => {
    const engines = buildEngines({ OPENAI_API_KEY: "sk-o", ANTHROPIC_API_KEY: "sk-a" } as unknown as NodeJS.ProcessEnv);
    expect(engines.map((e) => e.name)).toEqual(["openai-search"]);
  });
  it("wires both engines when GEO_ENGINE=both and both keys are present", () => {
    const engines = buildEngines({
      OPENAI_API_KEY: "sk-o", ANTHROPIC_API_KEY: "sk-a", GEO_ENGINE: "both",
    } as unknown as NodeJS.ProcessEnv);
    expect(engines.map((e) => e.name)).toEqual(["openai-search", "claude-search"]);
  });
  it("selects Claude when GEO_ENGINE=claude even if it is the only key", () => {
    const engines = buildEngines({ ANTHROPIC_API_KEY: "sk-a", GEO_ENGINE: "claude" } as unknown as NodeJS.ProcessEnv);
    expect(engines.map((e) => e.name)).toEqual(["claude-search"]);
  });
  it("returns [] for GEO_ENGINE=openai without an OpenAI key", () => {
    const engines = buildEngines({ ANTHROPIC_API_KEY: "sk-a", GEO_ENGINE: "openai" } as unknown as NodeJS.ProcessEnv);
    expect(engines).toEqual([]);
  });
});
