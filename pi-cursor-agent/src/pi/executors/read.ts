import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { createReadTool } from "@mariozechner/pi-coding-agent";
import type {
  ReadArgs,
  ReadResult,
} from "../../__generated__/agent/v1/read_exec_pb";
import {
  ReadError,
  ReadRejected,
  ReadResult as ReadResultClass,
  ReadSuccess,
} from "../../__generated__/agent/v1/read_exec_pb";
import type { Executor } from "../../vendor/agent-exec";
import {
  decodeToolCallId,
  executePiTool,
  type PiToolContext,
} from "../local-resource-provider/types";
import { toolResultToText, toolResultWasTruncated } from "../utils/tool-result";

function buildReadResultFromToolResult(
  path: string,
  result: ToolResultMessage,
): ReadResult {
  const text = toolResultToText(result);
  if (result.isError) {
    return new ReadResultClass({
      result: {
        case: "error",
        value: new ReadError({ path, error: text || "Read failed" }),
      },
    });
  }
  const totalLines = text ? text.split("\n").length : 0;
  return new ReadResultClass({
    result: {
      case: "success",
      value: new ReadSuccess({
        path,
        totalLines,
        fileSize: BigInt(Buffer.byteLength(text, "utf-8")),
        truncated: toolResultWasTruncated(result),
        output: { case: "content", value: text },
      }),
    },
  });
}

function buildReadRejectedResult(path: string, reason: string): ReadResult {
  return new ReadResultClass({
    result: { case: "rejected", value: new ReadRejected({ path, reason }) },
  });
}

export class LocalReadExecutor implements Executor<ReadArgs, ReadResult> {
  private readonly readTool;
  private readonly ctx: PiToolContext;

  constructor(ctx: PiToolContext) {
    this.ctx = ctx;
    this.readTool = createReadTool(ctx.cwd);
  }

  async execute(_ctx: unknown, args: ReadArgs): Promise<ReadResult> {
    const toolCallId = decodeToolCallId(args.toolCallId);

    if (!this.ctx.getActiveTools().has("read")) {
      return buildReadRejectedResult(args.path, "Tool not available");
    }

    const toolResult = await executePiTool(
      this.ctx,
      this.readTool,
      "read",
      toolCallId,
      { path: args.path },
    );
    return buildReadResultFromToolResult(args.path, toolResult);
  }
}
