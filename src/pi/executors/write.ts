import { createWriteTool } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import fs from "node:fs/promises";
import path from "node:path";
import type { Executor } from "../../vendor/agent-exec";
import { resolvePath } from "../../vendor/local-exec";
import type {
  WriteArgs,
  WriteResult,
} from "../../__generated__/agent/v1/write_exec_pb";
import {
  WriteError,
  WriteRejected,
  WriteResult as WriteResultClass,
  WriteSuccess,
} from "../../__generated__/agent/v1/write_exec_pb";
import { toolResultToText } from "../utils/tool-result";
import {
  type PiToolContext,
  decodeToolCallId,
  executePiTool,
  buildErrorResult,
  createToolResultMessage,
} from "../local-resource-provider/types";

function buildWriteResultFromToolResult(
  args: {
    path: string;
    fileText?: string;
    fileBytes?: Uint8Array;
    returnFileContentAfterWrite?: boolean;
  },
  result: ToolResultMessage,
): WriteResult {
  const text = toolResultToText(result);
  if (result.isError) {
    return new WriteResultClass({
      result: {
        case: "error",
        value: new WriteError({
          path: args.path,
          error: text || "Write failed",
        }),
      },
    });
  }
  const fileText = args.fileText ?? "";
  const fileSize =
    args.fileBytes?.length ?? Buffer.byteLength(fileText, "utf-8");
  const linesCreated = fileText ? fileText.split("\n").length : 0;
  return new WriteResultClass({
    result: {
      case: "success",
      value: new WriteSuccess({
        path: args.path,
        linesCreated,
        fileSize,
        ...(args.returnFileContentAfterWrite
          ? { fileContentAfterWrite: fileText }
          : {}),
      }),
    },
  });
}

function buildWriteRejectedResult(path: string, reason: string): WriteResult {
  return new WriteResultClass({
    result: { case: "rejected", value: new WriteRejected({ path, reason }) },
  });
}

export class LocalWriteExecutor implements Executor<WriteArgs, WriteResult> {
  private readonly writeTool;
  private readonly ctx: PiToolContext;

  constructor(ctx: PiToolContext) {
    this.ctx = ctx;
    this.writeTool = createWriteTool(ctx.cwd);
  }

  async execute(_ctx: unknown, args: WriteArgs): Promise<WriteResult> {
    const toolCallId = decodeToolCallId(args.toolCallId);

    if (!this.ctx.getActiveTools().has("write")) {
      return buildWriteRejectedResult(args.path, "Tool not available");
    }

    if (
      args.fileBytes &&
      args.fileBytes.length > 0 &&
      (!args.fileText || args.fileText.length === 0)
    ) {
      const toolResult = await this.executeBinaryWrite(
        { path: args.path, fileBytes: args.fileBytes },
        toolCallId,
      );
      return buildWriteResultFromToolResult(
        {
          path: args.path,
          fileBytes: args.fileBytes,
          returnFileContentAfterWrite: args.returnFileContentAfterWrite,
        },
        toolResult,
      );
    }

    const fileText =
      args.fileText ??
      new TextDecoder().decode(args.fileBytes ?? new Uint8Array());

    const toolResult = await executePiTool(
      this.ctx,
      this.writeTool,
      "write",
      toolCallId,
      { path: args.path, content: fileText },
    );
    return buildWriteResultFromToolResult(
      {
        path: args.path,
        fileText,
        returnFileContentAfterWrite: args.returnFileContentAfterWrite,
      },
      toolResult,
    );
  }

  private async executeBinaryWrite(
    writeArgs: { path: string; fileBytes: Uint8Array },
    toolCallId: string,
  ) {
    const toolArgs = {
      path: writeArgs.path,
      binary: true,
      size: writeArgs.fileBytes.length,
    };

    const extCtx = this.ctx.getCtx();
    if (extCtx?.hasUI) {
      extCtx.ui.setWorkingMessage("Cursor: write (binary)");
      extCtx.ui.setStatus("cursor", `write: ${writeArgs.path}`);
    }
    this.ctx.onToolExec?.({
      type: "start",
      toolCallId,
      toolName: "write",
      args: toolArgs,
    });

    const absolutePath = resolvePath(writeArgs.path, this.ctx.cwd);
    let result: AgentToolResult<unknown>;
    let isError = false;

    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, Buffer.from(writeArgs.fileBytes));
      result = {
        content: [
          {
            type: "text",
            text: `Successfully wrote ${writeArgs.fileBytes.length} bytes to ${writeArgs.path}`,
          },
        ],
        details: undefined,
      } as any;
    } catch (error) {
      isError = true;
      result = buildErrorResult(
        error instanceof Error ? error.message : String(error),
      );
    }

    const toolResult = createToolResultMessage(
      toolCallId,
      "write",
      result,
      isError,
    );
    this.ctx.onToolExec?.({
      type: "end",
      toolCallId,
      toolName: "write",
      args: toolArgs,
      result: toolResult,
    });

    if (extCtx?.hasUI) {
      extCtx.ui.setWorkingMessage();
      extCtx.ui.setStatus("cursor", undefined);
    }

    return toolResult;
  }
}
