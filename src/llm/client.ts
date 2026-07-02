import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexecFile = promisify(execFile);

export interface LlmClient {
  complete(o: { system: string; user: string; maxTokens?: number }): Promise<string>;
}

/** Spawns a subprocess and returns its stdout. Injectable for tests. */
export type CliRunner = (cmd: string, args: string[], opts: { maxBuffer?: number }) => Promise<{ stdout: string }>;

/**
 * Drives the ambient `claude` CLI (headless `-p` print mode) instead of the Anthropic SDK,
 * so a cloud routine can reason with the SESSION'S OWN Claude auth and carry NO API key.
 * System + user are folded into one prompt; callers already extract JSON from free text.
 */
export class ClaudeCliClient implements LlmClient {
  private run: CliRunner;
  constructor(private model?: string, runner?: CliRunner) {
    this.run = runner ?? (async (cmd, args, opts) => pexecFile(cmd, args, opts));
  }
  async complete(o: { system: string; user: string; maxTokens?: number }): Promise<string> {
    const prompt = `${o.system}\n\n----- INPUT -----\n\n${o.user}`;
    const args = ["-p", prompt, "--output-format", "text"];
    if (this.model) args.push("--model", this.model);
    const { stdout } = await this.run("claude", args, { maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  }
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
