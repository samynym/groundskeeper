export interface GeoAnswer {
  answerText: string;
  /** Absolute URLs. Real engine adapters MUST normalize to absolute (scheme + host);
   *  citation detection is host-based and treats a scheme-less string as not cited. */
  citedUrls: string[];
  ok: boolean;
}

export interface GeoEngineClient {
  name: string;
  ask(question: string): Promise<GeoAnswer>;
}

/** Test double: returns scripted answers in order; throws when exhausted. */
export class FakeEngine implements GeoEngineClient {
  private i = 0;
  constructor(public name: string, private queue: GeoAnswer[]) {}
  async ask(_question: string): Promise<GeoAnswer> {
    if (this.i >= this.queue.length) throw new Error(`FakeEngine ${this.name} exhausted`);
    return this.queue[this.i++];
  }
}
