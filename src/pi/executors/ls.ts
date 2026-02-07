import { createLsTool } from "@mariozechner/pi-coding-agent";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type { Executor } from "../../vendor/agent-exec";
import type { LsArgs, LsResult } from "../../__generated__/agent/v1/ls_exec_pb";
import {
  LsError,
  LsRejected,
  LsResult as LsResultClass,
  LsSuccess,
} from "../../__generated__/agent/v1/ls_exec_pb";
import {
  LsDirectoryTreeNode,
  LsDirectoryTreeNode_File,
} from "../../__generated__/agent/v1/selected_context_pb";
import { toolResultToText } from "../utils/tool-result";
import { type PiToolContext, decodeToolCallId, executePiTool } from "../local-resource-provider/types";

function buildLsResultFromToolResult(
  path: string,
  result: ToolResultMessage,
): LsResult {
  const text = toolResultToText(result);
  if (result.isError) {
    return new LsResultClass({
      result: { case: "error", value: new LsError({ path, error: text || "Ls failed" }) },
    });
  }

  const rootPath = path || ".";
  const entries = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("["));

  const childrenDirs: LsDirectoryTreeNode[] = [];
  const childrenFiles: LsDirectoryTreeNode_File[] = [];

  for (const entry of entries) {
    const name = entry.split(" (")[0];
    if (name?.endsWith("/")) {
      const dirName = name.slice(0, -1);
      childrenDirs.push(
        new LsDirectoryTreeNode({
          absPath: `${rootPath.replace(/\/$/, "")}/${dirName}`,
          childrenDirs: [],
          childrenFiles: [],
          childrenWereProcessed: false,
          fullSubtreeExtensionCounts: {},
          numFiles: 0,
        }),
      );
    } else {
      childrenFiles.push(
        new LsDirectoryTreeNode_File(name ? { name } : undefined),
      );
    }
  }

  const root = new LsDirectoryTreeNode({
    absPath: rootPath,
    childrenDirs,
    childrenFiles,
    childrenWereProcessed: true,
    fullSubtreeExtensionCounts: {},
    numFiles: childrenFiles.length,
  });

  return new LsResultClass({
    result: {
      case: "success",
      value: new LsSuccess({ directoryTreeRoot: root }),
    },
  });
}

function buildLsRejectedResult(path: string, reason: string): LsResult {
  return new LsResultClass({
    result: { case: "rejected", value: new LsRejected({ path, reason }) },
  });
}

export class LocalLsExecutor implements Executor<LsArgs, LsResult> {
  private readonly lsTool;
  private readonly ctx: PiToolContext;

  constructor(ctx: PiToolContext) {
    this.ctx = ctx;
    this.lsTool = createLsTool(ctx.cwd);
  }

  async execute(_ctx: unknown, args: LsArgs): Promise<LsResult> {
    const toolCallId = decodeToolCallId(args.toolCallId);

    if (!this.ctx.getActiveTools().has("ls")) {
      return buildLsRejectedResult(args.path, "Tool not available");
    }

    const toolResult = await executePiTool(
      this.ctx,
      this.lsTool,
      "ls",
      toolCallId,
      { path: args.path || "." },
    );
    return buildLsResultFromToolResult(args.path, toolResult);
  }
}
