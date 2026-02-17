import type { LocalGitExecutor } from "./git-executor";

const GIT_STATUS_TIMEOUT_MS = 5_000;

export async function getGitRepoPath(
  gitExecutor: LocalGitExecutor,
  workspacePath: string,
): Promise<string | null> {
  try {
    const result = await gitExecutor.exec(workspacePath, [
      "rev-parse",
      "--show-toplevel",
    ]);
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getGitStatus(
  gitExecutor: LocalGitExecutor,
  repoPath: string,
  timeoutMs: number = GIT_STATUS_TIMEOUT_MS,
): Promise<string | undefined> {
  try {
    // Use --short for fast, compact output (agents can read it fine)
    const result = await gitExecutor.exec(
      repoPath,
      ["--no-optional-locks", "status", "--short", "--branch"],
      { timeout: timeoutMs },
    );
    return result.stdout;
  } catch {
    return undefined;
  }
}

export async function getGitBranch(
  gitExecutor: LocalGitExecutor,
  repoPath: string,
): Promise<string | undefined> {
  try {
    const result = await gitExecutor.exec(repoPath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    const branch = result.stdout.trim();
    if (branch === "HEAD" || branch.length === 0) {
      return undefined;
    }
    return branch;
  } catch {
    return undefined;
  }
}

/**
 * Gets the remote origin URL for a git repository.
 * Returns undefined if no remote origin is configured.
 *
 * @param gitExecutor - GitExecutor to use for running git commands
 * @param repoPath - The path to the git repository root
 */
export async function getGitRemoteUrl(
  gitExecutor: LocalGitExecutor,
  repoPath: string,
): Promise<string | undefined> {
  try {
    const result = await gitExecutor.exec(repoPath, [
      "config",
      "--get",
      "remote.origin.url",
    ]);
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
