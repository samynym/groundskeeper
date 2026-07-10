import { describe, it, expect } from "vitest";
import { IndexNowSubmit } from "./indexnow.js";

const opts = { key: "abc123", host: "growsteady.me" };

describe("IndexNowSubmit", () => {
  it("POSTs host/key/keyLocation/urlList and maps 200 to applied", async () => {
    let captured: { url: string; body: unknown } | null = null;
    const post = async (url: string, body: unknown) => { captured = { url, body }; return { status: 200 }; };
    const r = await new IndexNowSubmit({ ...opts, post }).run(["https://growsteady.me/", "https://growsteady.me/acl"]);
    expect(r.outcome).toBe("applied");
    expect(captured!.url).toBe("https://api.indexnow.org/indexnow");
    expect(captured!.body).toEqual({
      host: "growsteady.me",
      key: "abc123",
      keyLocation: "https://growsteady.me/abc123.txt",
      urlList: ["https://growsteady.me/", "https://growsteady.me/acl"],
    });
  });
  it("202 is also applied; other statuses are failed with the status in notes", async () => {
    expect((await new IndexNowSubmit({ ...opts, post: async () => ({ status: 202 }) }).run(["u"])).outcome).toBe("applied");
    const r = await new IndexNowSubmit({ ...opts, post: async () => ({ status: 403 }) }).run(["u"]);
    expect(r).toEqual({ outcome: "failed", notes: "http 403" });
  });
  it("a thrown post is failed (recorded), never an exception", async () => {
    const r = await new IndexNowSubmit({ ...opts, post: async () => { throw new Error("ENOTFOUND"); } }).run(["u"]);
    expect(r.outcome).toBe("failed");
    expect(r.notes).toContain("ENOTFOUND");
  });
  it("honors explicit keyLocation and endpoint overrides", async () => {
    let captured: { url: string; body: unknown } | null = null;
    const post = async (url: string, body: unknown) => { captured = { url, body }; return { status: 200 }; };
    await new IndexNowSubmit({ ...opts, keyLocation: "https://growsteady.me/k/f.txt", endpoint: "https://bing.example/indexnow", post }).run(["u"]);
    expect(captured!.url).toBe("https://bing.example/indexnow");
    expect((captured!.body as { keyLocation: string }).keyLocation).toBe("https://growsteady.me/k/f.txt");
  });
});
