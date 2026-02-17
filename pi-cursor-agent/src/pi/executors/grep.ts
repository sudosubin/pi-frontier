import { createGrepTool } from "@mariozechner/pi-coding-agent";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type { Executor } from "../../vendor/agent-exec";
import type {
  GrepArgs,
  GrepResult,
} from "../../__generated__/agent/v1/grep_exec_pb";
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
} from "../../__generated__/agent/v1/grep_exec_pb";
import { toolResultToText, toolResultDetailBoolean } from "../utils/tool-result";
import { type PiToolContext, decodeToolCallId, executePiTool } from "../local-resource-provider/types";

function extractGrepFileFromLine(line: string): string | null {
  const matchLine = line.match(/^(.+?):\d+:/);
  if (matchLine) return matchLine[1] ?? null;
  const contextLine = line.match(/^(.+?)-\d+-/);
  if (contextLine) return contextLine[1] ?? null;
  return null;
}

function buildGrepResultFromToolResult(
  args: { pattern: string; path?: string; outputMode?: string },
  result: ToolResultMessage,
): GrepResult {
  const text = toolResultToText(result);
  if (result.isError) {
    return buildGrepErrorResult(text || "Grep failed");
  }

  const outputMode = args.outputMode || "content";
  const clientTruncated = toolResultDetailBoolean(result, "truncated");
  const lines = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("[") &&
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
    let parsedCountLines = false;

    for (const line of lines) {
      const countMatch = line.match(/^(.+?):(\d+)$/);
      if (countMatch) {
        parsedCountLines = true;
        const file = countMatch[1];
        const countValue = Number.parseInt(countMatch[2] ?? "0", 10);
        if (!Number.isNaN(countValue)) {
          counts.set(file ?? "", countValue);
        }
        continue;
      }
      const matchLine = line.match(/^(.+?):(\d+):\s?(.*)$/);
      const contextLine = line.match(/^(.+?)-(\d+)-\s?(.*)$/);
      if (matchLine && !contextLine) {
        const file = matchLine[1] ?? "";
        counts.set(file, (counts.get(file) ?? 0) + 1);
      }
    }

    if (!parsedCountLines && counts.size === 0 && lines.length > 0) {
      for (const line of lines) {
        const file = extractGrepFileFromLine(line);
        if (file) counts.set(file, (counts.get(file) ?? 0) + 1);
      }
    }

    const countEntries = Array.from(counts.entries()).map(
      ([file, count]) => new GrepFileCount({ file, count }),
    );
    const totalMatches = countEntries.reduce(
      (sum, entry) => sum + entry.count,
      0,
    );

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
      const file = match[1];
      const lineNumber = match[2];
      const content = match[3] ?? "";
      const isContextLine = Boolean(contextLine);
      const list = matchMap.get(file ?? "") ?? [];
      list.push({ line: Number(lineNumber), content, isContextLine });
      matchMap.set(file ?? "", list);
      if (!isContextLine) totalMatchedLines += 1;
    }

    const matches = Array.from(matchMap.entries()).map(
      ([file, fileMatches]) =>
        new GrepFileMatch({
          file,
          matches: fileMatches.map(
            (entry) =>
              new GrepContentMatch({
                lineNumber: entry.line,
                content: entry.content,
                contentTruncated: false,
                isContextLine: entry.isContextLine,
              }),
          ),
        }),
    );
    const totalLines = matches.reduce(
      (sum, entry) => sum + entry.matches.length,
      0,
    );
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

export class LocalGrepExecutor implements Executor<GrepArgs, GrepResult> {
  private readonly grepTool;
  private readonly ctx: PiToolContext;

  constructor(ctx: PiToolContext) {
    this.ctx = ctx;
    this.grepTool = createGrepTool(ctx.cwd);
  }

  async execute(_ctx: unknown, args: GrepArgs): Promise<GrepResult> {
    const toolCallId = decodeToolCallId(args.toolCallId);

    if (!this.ctx.getActiveTools().has("grep")) {
      return buildGrepErrorResult("Tool not available");
    }

    const toolResult = await executePiTool(
      this.ctx,
      this.grepTool,
      "grep",
      toolCallId,
      {
        pattern: args.pattern,
        path: args.path || undefined,
        glob: args.glob || undefined,
        ignoreCase: args.caseInsensitive || undefined,
        context:
          args.context ?? args.contextBefore ?? args.contextAfter ?? undefined,
        limit: args.headLimit ?? undefined,
      },
    );

    return buildGrepResultFromToolResult(
      {
        pattern: args.pattern,
        ...(args.path ? { path: args.path } : {}),
        ...(args.outputMode ? { outputMode: args.outputMode } : {}),
      },
      toolResult,
    );
  }
}
