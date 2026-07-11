import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeSearchEngine, buildEngines } from "./claude-search-engine.js";

// Schema-accurate Message fixture (fields we read: content[].{type,text,citations}).
const msg = (content: unknown[]): Anthropic.Message =>
  ({ content } as unknown as Anthropic.Message);

const webCite = (url: string): Anthropic.CitationsWebSearchResultLocation => ({
  type: "web_search_result_location",
  url,
  title: "t",
  cited_text: "c",
  encrypted_index: "e",
});

describe("ClaudeSearchEngine", () => {
  it("maps web-search citations to deduped absolute citedUrls and concatenates text", async () => {
    const create = async () =>
      msg([
        { type: "server_tool_use", id: "s1", name: "web_search", input: {} },
        { type: "text", text: "ACL recovery ", citations: [webCite("https://growsteady.me/acl-recovery-timeline")] },
        { type: "text", text: "takes months.", citations: [
          webCite("https://growsteady.me/acl-recovery-timeline"), // dupe
          webCite("https://mayoclinic.org/acl"),
        ] },
      ]);
    const eng = new ClaudeSearchEngine(create, { model: "claude-sonnet-4-6" });
    const a = await eng.ask("how long does acl surgery recovery take");
    expect(a.ok).toBe(true);
    expect(a.answerText).toBe("ACL recovery takes months.");
    expect(a.citedUrls).toEqual([
      "https://growsteady.me/acl-recovery-timeline",
      "https://mayoclinic.org/acl",
    ]);
  });

  it("ignores non-web-search citation types and blocks with no citations", async () => {
    const create = async () =>
      msg([
        { type: "text", text: "from a pdf", citations: [
          { type: "page_location", document_index: 0, document_title: null, start_page_number: 1, end_page_number: 2, cited_text: "x" },
        ] },
        { type: "text", text: " and uncited", citations: null },
      ]);
    const a = await new ClaudeSearchEngine(create, { model: "m" }).ask("q");
    expect(a.ok).toBe(true);
    expect(a.answerText).toBe("from a pdf and uncited");
    expect(a.citedUrls).toEqual([]);
  });

  it("captures the full retrieval set and engine queries from tool blocks", async () => {
    const create = async () =>
      msg([
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "acl recovery site:growsteady.me" } },
        { type: "web_search_tool_result", tool_use_id: "s1", content: [
          { type: "web_search_result", url: "https://hss.edu/acl", title: "t", encrypted_content: "e", page_age: null },
          { type: "web_search_result", url: "https://growsteady.me/acl-recovery-timeline", title: "t", encrypted_content: "e", page_age: null },
          { type: "web_search_result", url: "https://hss.edu/acl", title: "dupe", encrypted_content: "e", page_age: null },
        ] },
        { type: "text", text: "answer", citations: [webCite("https://hss.edu/acl")] },
      ]);
    const a = await new ClaudeSearchEngine(create, { model: "m" }).ask("q");
    expect(a.retrievedUrls).toEqual(["https://hss.edu/acl", "https://growsteady.me/acl-recovery-timeline"]);
    expect(a.engineQueries).toEqual(["acl recovery site:growsteady.me"]);
  });

  it("returns retrievedUrls: null (NOT []) when no web_search_tool_result blocks exist", async () => {
    const create = async () => msg([{ type: "text", text: "no search ran", citations: null }]);
    const a = await new ClaudeSearchEngine(create, { model: "m" }).ask("q");
    expect(a.retrievedUrls).toBeNull();
    expect(a.engineQueries).toBeNull();
  });

  it("returns retrievedUrls: [] when the search ran but returned nothing", async () => {
    const create = async () =>
      msg([
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "q" } },
        { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
        { type: "text", text: "nothing found", citations: null },
      ]);
    const a = await new ClaudeSearchEngine(create, { model: "m" }).ask("q");
    expect(a.retrievedUrls).toEqual([]);
    expect(a.engineQueries).toEqual(["q"]);
  });

  it("fails safe (ok:false) when the API call throws", async () => {
    const create = async () => { throw new Error("529 overloaded"); };
    const a = await new ClaudeSearchEngine(create, { model: "m" }).ask("q");
    expect(a).toEqual({ answerText: "", citedUrls: [], retrievedUrls: null, engineQueries: null, ok: false });
  });

  it("names itself claude-search for per-engine attribution", () => {
    expect(new ClaudeSearchEngine(async () => msg([]), { model: "m" }).name).toBe("claude-search");
  });
});

describe("buildEngines", () => {
  it("returns [] without an API key (GEO stays empty, never fabricated)", () => {
    expect(buildEngines({} as NodeJS.ProcessEnv)).toEqual([]);
  });
  it("wires a single claude-search engine when ANTHROPIC_API_KEY is present", () => {
    const engines = buildEngines({ ANTHROPIC_API_KEY: "sk-test" } as unknown as NodeJS.ProcessEnv);
    expect(engines.map((e) => e.name)).toEqual(["claude-search"]);
  });
});
