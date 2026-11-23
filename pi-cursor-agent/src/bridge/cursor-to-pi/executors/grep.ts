import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import nodePath from "node:path";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type {
  GrepArgs,
  GrepResult,
} from "../../../__generated__/agent/v1/grep_exec_pb";
import {
  GrepContentMatch,
  GrepContentResult,
  GrepCountResult,
  GrepError,
  GrepFileCount,
  GrepFileMatch,
  GrepFilesResult,
  GrepResult as GrepResultClass,
  GrepSuccess,
  GrepUnionResult,
} from "../../../__generated__/agent/v1/grep_exec_pb";
import type { Executor } from "../../../vendor/agent-exec";
import {
  toolResultDetailBoolean,
  toolResultToText,
} from "../../shared/tool-result";
import {
  decodeToolCallId,
  type PiToolContext,
} from "../local-resource-provider/types";
import { requestToolExecution, shellQuote } from "../tool-bridge";

type SearchBackend = "rg" | "grep";

function extractGrepFileFromLine(line: string): string | null {
  const matchLine = line.match(/^(.+?):\d+:/);
  if (matchLine) return matchLine[1] ?? null;
  const contextLine = line.match(/^(.+?)-\d+-/);
  if (contextLine) return contextLine[1] ?? null;
  return null;
}

function isNoMatchesError(text: string): boolean {
  const normalized = text.trim();
  if (!normalized.endsWith("Command exited with code 1")) return false;
  const prefix = normalized
    .slice(0, normalized.length - "Command exited with code 1".length)
    .trim();
  return prefix === "" || prefix === "(no output)";
}

function buildGrepResultFromToolResult(
  args: { pattern: string; path?: string; outputMode?: string },
  result: ToolResultMessage,
): GrepResult {
  const rawText = toolResultToText(result);
  const noMatches = result.isError && isNoMatchesError(rawText);
  if (result.isError && !noMatches) {
    return buildGrepErrorResult(rawText || "Grep failed");
  }

  const text = noMatches ? "" : rawText;
  const outputMode = args.outputMode || "content";
  const clientTruncated = toolResultDetailBoolean(result, "truncated");
  const lines = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(
      (line) =>
        line.length > 0 &&
        line !== "--" &&
        !line.startsWith("[") &&
        !line.startsWith("Binary file ") &&
        !line.toLowerCase().startsWith("no matches"),
    );

  const workspaceKey = args.path || ".";
  let unionResult: GrepUnionResult;

  if (outputMode === "files_with_matches") {
    const fileSet = new Set<string>();
    for (const line of lines) {
      const file = extractGrepFileFromLine(line) ?? line;
      if (file) fileSet.add(file);
    }
    const files = Array.from(fileSet.values());
    unionResult = new GrepUnionResult({
      result: {
        case: "files",
        value: new GrepFilesResult({
          files,
          totalFiles: files.length,
          clientTruncated,
          ripgrepTruncated: false,
        }),
      },
    });
  } else if (outputMode === "count") {
    const counts = new Map<string, number>();
    for (const line of lines) {
      const countMatch = line.match(/^(.+?):(\d+)$/);
      if (countMatch) {
        counts.set(
          countMatch[1] ?? "",
          Number.parseInt(countMatch[2] ?? "0", 10),
        );
        continue;
      }
      const file = extractGrepFileFromLine(line);
      if (file) counts.set(file, (counts.get(file) ?? 0) + 1);
    }
    const countEntries = Array.from(counts.entries()).map(
      ([file, count]) => new GrepFileCount({ file, count }),
    );
    const totalMatches = countEntries.reduce((sum, e) => sum + e.count, 0);
    unionResult = new GrepUnionResult({
      result: {
        case: "count",
        value: new GrepCountResult({
          counts: countEntries,
          totalFiles: countEntries.length,
          totalMatches,
          clientTruncated,
          ripgrepTruncated: false,
        }),
      },
    });
  } else {
    const matchMap = new Map<
      string,
      Array<{ line: number; content: string; isContextLine: boolean }>
    >();
    let totalMatchedLines = 0;
    for (const line of lines) {
      const matchLine = line.match(/^(.+?):(\d+):\s?(.*)$/);
      const contextLine = line.match(/^(.+?)-(\d+)-\s?(.*)$/);
      const match = matchLine ?? contextLine;
      if (!match) continue;
      const file = match[1] ?? "";
      const lineNumber = Number(match[2]);
      const content = match[3] ?? "";
      const isContext = Boolean(contextLine);
      const list = matchMap.get(file) ?? [];
      list.push({ line: lineNumber, content, isContextLine: isContext });
      matchMap.set(file, list);
      if (!isContext) totalMatchedLines += 1;
    }
    const matches = Array.from(matchMap.entries()).map(
      ([file, fileMatches]) =>
        new GrepFileMatch({
          file,
          matches: fileMatches.map(
            (e) =>
              new GrepContentMatch({
                lineNumber: e.line,
                content: e.content,
                contentTruncated: false,
                isContextLine: e.isContextLine,
              }),
          ),
        }),
    );
    const totalLines = matches.reduce((sum, e) => sum + e.matches.length, 0);
    unionResult = new GrepUnionResult({
      result: {
        case: "content",
        value: new GrepContentResult({
          matches,
          totalLines,
          totalMatchedLines,
          clientTruncated,
          ripgrepTruncated: false,
        }),
      },
    });
  }

  return new GrepResultClass({
    result: {
      case: "success",
      value: new GrepSuccess({
        pattern: args.pattern,
        path: args.path || "",
        outputMode,
        workspaceResults: { [workspaceKey]: unionResult },
      }),
    },
  });
}

function buildGrepErrorResult(error: string): GrepResult {
  return new GrepResultClass({
    result: { case: "error", value: new GrepError({ error }) },
  });
}

function untildify(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return nodePath.join(homedir(), input.slice(2));
  return input;
}

function getPathEnv(): string {
  const pathKey =
    Object.keys(process.env).find((key) => key.toLowerCase() === "path") ??
    "PATH";
  return process.env[pathKey] ?? "";
}

function getManagedBinDir(): string {
  const agentDir = process.env["PI_CODING_AGENT_DIR"];
  const baseDir = agentDir
    ? untildify(agentDir)
    : nodePath.join(homedir(), ".pi", "agent");
  return nodePath.join(baseDir, "bin");
}

function getEffectiveSearchPathDirs(): string[] {
  const pathDirs = getPathEnv()
    .split(nodePath.delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean)
    .map(untildify);

  return Array.from(new Set([getManagedBinDir(), ...pathDirs]));
}

function getCommandCandidates(commandName: string): string[] {
  if (process.platform !== "win32") return [commandName];
  return [
    commandName,
    `${commandName}.exe`,
    `${commandName}.cmd`,
    `${commandName}.bat`,
    `${commandName}.com`,
  ];
}

async function commandExistsInDir(
  dir: string,
  commandName: string,
): Promise<boolean> {
  const accessMode =
    process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK;

  for (const candidate of getCommandCandidates(commandName)) {
    try {
      await access(nodePath.join(dir, candidate), accessMode);
      return true;
    } catch {
      // try next candidate
    }
  }

  return false;
}

async function resolveSearchBackend(): Promise<SearchBackend | null> {
  const dirs = getEffectiveSearchPathDirs();

  for (const backend of ["rg", "grep"] as const) {
    for (const dir of dirs) {
      if (await commandExistsInDir(dir, backend)) {
        return backend;
      }
    }
  }

  return null;
}

/**
 * Build rg command from cursor grep args.
 */
function buildRgCommand(args: GrepArgs): string {
  const parts = ["rg", "--line-number", "--with-filename", "--no-heading"];
  if (args.caseInsensitive) parts.push("--ignore-case");
  else parts.push("--case-sensitive");
  if (args.glob) parts.push("--iglob", shellQuote(args.glob));
  if (args.context) parts.push("-C", String(args.context));
  else if (args.contextBefore) parts.push("-B", String(args.contextBefore));
  else if (args.contextAfter) parts.push("-A", String(args.contextAfter));
  if (args.headLimit && args.headLimit > 0)
    parts.push("-m", String(args.headLimit));
  if (args.outputMode === "files_with_matches") parts.push("-l");
  else if (args.outputMode === "count") parts.push("-c", "--with-filename");
  parts.push("--color=never", "--no-config", "--hidden", "--glob", "'!.git'");
  parts.push("--", shellQuote(args.pattern));
  parts.push(args.path ? shellQuote(args.path) : ".");
  return parts.join(" ");
}

function buildGrepCommand(args: GrepArgs): string {
  const parts = ["grep", "-R", "-H", "-I"];

  if (args.outputMode === "files_with_matches") {
    parts.push("-l");
  } else if (args.outputMode === "count") {
    parts.push("-c");
  } else {
    parts.push("-n");
    if (args.context) parts.push("-C", String(args.context));
    else {
      if (args.contextBefore) parts.push("-B", String(args.contextBefore));
      if (args.contextAfter) parts.push("-A", String(args.contextAfter));
    }
  }

  if (args.caseInsensitive) parts.push("-i");
  if (args.headLimit && args.headLimit > 0)
    parts.push("-m", String(args.headLimit));

  parts.push("--", shellQuote(args.pattern));
  parts.push(args.path ? shellQuote(args.path) : ".");
  return parts.join(" ");
}

export class LocalGrepExecutor implements Executor<GrepArgs, GrepResult> {
  private readonly ctx: PiToolContext;

  constructor(ctx: PiToolContext) {
    this.ctx = ctx;
  }

  async execute(_ctx: unknown, args: GrepArgs): Promise<GrepResult> {
    const toolCallId = decodeToolCallId(args.toolCallId);

    if (!this.ctx.getActiveTools().has("bash")) {
      return buildGrepErrorResult("Tool not available");
    }

    const backend = await resolveSearchBackend();
    if (!backend) {
      return buildGrepErrorResult("Neither rg nor grep is available");
    }

    if (backend === "grep" && args.glob) {
      return buildGrepErrorResult(
        "Glob filtering requires ripgrep (rg); grep fallback does not support glob",
      );
    }

    const command =
      backend === "rg" ? buildRgCommand(args) : buildGrepCommand(args);

    const piResult = await requestToolExecution(
      this.ctx.getChannel?.() ?? null,
      {
        toolCallId,
        cursorExecType: "grep",
        piToolName: "bash",
        piToolArgs: { command },
      },
    );

    return buildGrepResultFromToolResult(
      {
        pattern: args.pattern,
        ...(args.path ? { path: args.path } : {}),
        ...(args.outputMode ? { outputMode: args.outputMode } : {}),
      },
      piResult,
    );
  }
}
