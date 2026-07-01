import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);
type Runner = (cmd: string, args: string[], opts: { cwd: string }) => Promise<{ stdout: string; stderr: string }>;

export interface VerifierOpts {
  targetRepoPath: string;
  commands?: Array<[string, string[]]>;
  runner?: Runner;
}

export class BuildVerifier {
  private commands: Array<[string, string[]]>;
  private runner: Runner;
  constructor(private opts: VerifierOpts) {
    this.commands = opts.commands ?? [["npx", ["tsc", "--noEmit"]]];
    this.runner = opts.runner ?? ((c, a, o) => pexec(c, a, o));
  }
  async verify(): Promise<{ ok: boolean; log: string }> {
    let log = "";
    for (const [cmd, args] of this.commands) {
      try {
        const { stdout, stderr } = await this.runner(cmd, args, { cwd: this.opts.targetRepoPath });
        log += `$ ${cmd} ${args.join(" ")}\n${stdout}${stderr}\n`;
      } catch (e: any) {
        log += `$ ${cmd} ${args.join(" ")}\n${e.stdout ?? ""}${e.stderr ?? ""}${e.message}\n`;
        return { ok: false, log };
      }
    }
    return { ok: true, log };
  }
}
