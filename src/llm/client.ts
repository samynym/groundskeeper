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
