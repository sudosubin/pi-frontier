import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GitExecOptions {
  timeout?: number;
  caller?: string;
}

/**
 * Default GitExecutor implementation that spawns git processes directly.
 * Throws an error if the git command fails (non-zero exit code or spawn error).
 */
export class LocalGitExecutor {
  async exec(
    cwd: string,
    args: string[],
    options?: GitExecOptions,
  ): Promise<GitExecResult> {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout: options?.timeout,
    });
    return {
      exitCode: 0,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
    };
  }
}
