import type { ExperimentRunner } from "./experiments.js";

export type PostJson = (url: string, body: unknown) => Promise<{ status: number }>;

export interface IndexNowOpts {
  key: string;
  host: string;              // e.g. "growsteady.me"
  keyLocation?: string;      // default https://<host>/<key>.txt
  endpoint?: string;         // default https://api.indexnow.org/indexnow
  post?: PostJson;
}

const defaultPost: PostJson = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return { status: res.status };
};

/**
 * The one automated presence lever in v1. It is a HYPOTHESIS, not a fix:
 * IndexNow feeds Bing/Yandex/Seznam/Naver/Yep, and whether the answer
 * engine's backend is downstream of any of them is unknown — the probe
 * adjudicates. Inert until <host>/<key>.txt is deployed (PR into Steady).
 */
export class IndexNowSubmit implements ExperimentRunner {
  readonly name = "indexnow-submit";
  readonly scope = "url" as const;
  constructor(private opts: IndexNowOpts) {}

  async run(urls: string[]): Promise<{ outcome: "applied" | "failed"; notes: string }> {
    const endpoint = this.opts.endpoint ?? "https://api.indexnow.org/indexnow";
    const keyLocation = this.opts.keyLocation ?? `https://${this.opts.host}/${this.opts.key}.txt`;
    try {
      const { status } = await (this.opts.post ?? defaultPost)(endpoint, {
        host: this.opts.host,
        key: this.opts.key,
        keyLocation,
        urlList: urls,
      });
      return status === 200 || status === 202
        ? { outcome: "applied", notes: `http ${status}, ${urls.length} urls` }
        : { outcome: "failed", notes: `http ${status}` };
    } catch (e) {
      return { outcome: "failed", notes: `error: ${(e as Error).message}` };
    }
  }
}
