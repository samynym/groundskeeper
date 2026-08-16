export interface GeoAnswer {
  answerText: string;
  /** Absolute URLs. Real engine adapters MUST normalize to absolute (scheme + host);
   *  citation detection is host-based and treats a scheme-less string as not cited. */
  citedUrls: string[];
  /** Full retrieval set (every result the search backend returned, cited or not).
   *  null = this engine cannot report retrieval. NEVER use [] to mean "unknown". */
  retrievedUrls: string[] | null;
  /** Search queries the engine actually issued. null = engine cannot report them. */
  engineQueries: string[] | null;
  ok: boolean;
}

export interface GeoEngineClient {
  name: string;
  /**
   * The exact model that answers. Recorded alongside every run so a model
   * swap mid-experiment is visible in the data instead of silent — a floating
   * alias (e.g. "claude-sonnet-5") can change under a running experiment and
   * would otherwise look like a content effect.
   *
   * Deliberately NOT folded into `name`: that string keys the per-engine
   * verdicts and the snapshot timeline, so changing it would break comparison
   * against every earlier snapshot. undefined = engine cannot report it.
   */
  model?: string;
  ask(question: string): Promise<GeoAnswer>;
}

/** Test double: returns scripted answers in order; throws when exhausted. */
export class FakeEngine implements GeoEngineClient {
  private i = 0;
  constructor(public name: string, private queue: GeoAnswer[], public model?: string) {}
  async ask(_question: string): Promise<GeoAnswer> {
    if (this.i >= this.queue.length) throw new Error(`FakeEngine ${this.name} exhausted`);
    return this.queue[this.i++];
  }
}
