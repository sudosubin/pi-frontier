import fs from "node:fs/promises";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type {
  DeleteArgs,
  DeleteResult,
} from "../../__generated__/agent/v1/delete_exec_pb";
import {
  DeleteError,
  DeleteRejected,
  DeleteResult as DeleteResultClass,
  DeleteSuccess,
} from "../../__generated__/agent/v1/delete_exec_pb";
import type { Executor } from "../../vendor/agent-exec";
import { resolvePath } from "../../vendor/local-exec";
import {
  buildErrorResult,
  createToolResultMessage,
  decodeToolCallId,
  type PiToolContext,
} from "../local-resource-provider/types";
import { toolResultToText } from "../utils/tool-result";

function buildDeleteResultFromToolResult(
  path: string,
  result: ToolResultMessage,
): DeleteResult {
  const text = toolResultToText(result);
  if (result.isError) {
    return new DeleteResultClass({
      result: {
        case: "error",
        value: new DeleteError({ path, error: text || "Delete failed" }),
      },
    });
  }
  return new DeleteResultClass({
    result: {
      case: "success",
      value: new DeleteSuccess({
        path,
        deletedFile: path,
        fileSize: BigInt(0),
        prevContent: "",
      }),
    },
  });
}

function buildDeleteRejectedResult(path: string, reason: string): DeleteResult {
  return new DeleteResultClass({
    result: { case: "rejected", value: new DeleteRejected({ path, reason }) },
  });
}

export class LocalDeleteExecutor implements Executor<DeleteArgs, DeleteResult> {
  private readonly ctx: PiToolContext;

  constructor(ctx: PiToolContext) {
    this.ctx = ctx;
  }

  async execute(_ctx: unknown, args: DeleteArgs): Promise<DeleteResult> {
    const toolCallId = decodeToolCallId(args.toolCallId);

    if (!this.ctx.getActiveTools().has("write")) {
      return buildDeleteRejectedResult(args.path, "Tool not available");
    }

    const toolResult = await this.executeDelete(args.path, toolCallId);
    return buildDeleteResultFromToolResult(args.path, toolResult);
  }

  private async executeDelete(pathArg: string, toolCallId: string) {
    const toolArgs = { path: pathArg };

    const extCtx = this.ctx.getCtx();
    if (extCtx?.hasUI) {
      extCtx.ui.setWorkingMessage("Cursor: delete");
      extCtx.ui.setStatus("cursor-agent", `delete: ${pathArg}`);
    }
    this.ctx.onToolExec?.({
      type: "start",
      toolCallId,
      toolName: "delete",
      args: toolArgs,
    });

    const absolutePath = resolvePath(pathArg, this.ctx.cwd);
    let result: AgentToolResult<unknown>;
    let isError = false;

    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile()) {
        throw new Error(`Path is not a file: ${pathArg}`);
      }
      await fs.rm(absolutePath);
      const sizeText = stat.size ? ` (${stat.size} bytes)` : "";
      result = {
        content: [{ type: "text", text: `Deleted ${pathArg}${sizeText}` }],
        details: undefined,
      };
    } catch (error) {
      isError = true;
      result = buildErrorResult(
        error instanceof Error ? error.message : String(error),
      );
    }

    const toolResult = createToolResultMessage(
      toolCallId,
      "delete",
      result,
      isError,
    );
    this.ctx.onToolExec?.({
      type: "end",
      toolCallId,
      toolName: "delete",
      args: toolArgs,
      result: toolResult,
    });

    if (extCtx?.hasUI) {
      extCtx.ui.setWorkingMessage();
      extCtx.ui.setStatus("cursor-agent", undefined);
    }

    return toolResult;
  }
}
