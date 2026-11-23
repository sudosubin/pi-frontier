import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type {
  WriteArgs,
  WriteResult,
} from "../../../__generated__/agent/v1/write_exec_pb";
import {
  WriteError,
  WriteRejected,
  WriteResult as WriteResultClass,
  WriteSuccess,
} from "../../../__generated__/agent/v1/write_exec_pb";
import type { Executor } from "../../../vendor/agent-exec";
import { toolResultToText } from "../../shared/tool-result";
import {
  decodeToolCallId,
  type PiToolContext,
} from "../local-resource-provider/types";
import { requestToolExecution, shellQuote } from "../tool-bridge";

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
          ? { fullFileContent: fileText }
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

/**
 * Determine whether the write should be treated as binary.
 * Binary when fileBytes is present and fileText is absent or empty.
 */
function isBinaryWrite(args: WriteArgs): boolean {
  return (
    args.fileBytes != null &&
    args.fileBytes.length > 0 &&
    (!args.fileText || args.fileText.length === 0)
  );
}

/**
 * Build a bash command that decodes base64 stdin into the target path.
 * Uses a heredoc so the payload is not subject to ARG_MAX limits.
 */
function buildBase64WriteCommand(path: string, base64: string): string {
  return [
    `mkdir -p "$(dirname ${shellQuote(path)})"`,
    `base64 -d > ${shellQuote(path)} <<'__PI_BIN_EOF__'`,
    base64,
    "__PI_BIN_EOF__",
  ].join(" && \\\n");
}

export class LocalWriteExecutor implements Executor<WriteArgs, WriteResult> {
  private readonly ctx: PiToolContext;

  constructor(ctx: PiToolContext) {
    this.ctx = ctx;
  }

  async execute(_ctx: unknown, args: WriteArgs): Promise<WriteResult> {
    const toolCallId = decodeToolCallId(args.toolCallId);

    if (isBinaryWrite(args)) {
      return this.executeBinaryWrite(toolCallId, args);
    }

    return this.executeTextWrite(toolCallId, args);
  }

  /** Text write via pi's native `write` tool. */
  private async executeTextWrite(
    toolCallId: string,
    args: WriteArgs,
  ): Promise<WriteResult> {
    if (!this.ctx.getActiveTools().has("write")) {
      return buildWriteRejectedResult(args.path, "Tool not available");
    }

    const content = args.fileText ?? "";

    const piResult = await requestToolExecution(
      this.ctx.getChannel?.() ?? null,
      {
        toolCallId,
        cursorExecType: "write",
        piToolName: "write",
        piToolArgs: { path: args.path, content },
      },
    );

    return buildWriteResultFromToolResult(
      {
        path: args.path,
        fileText: args.fileText,
        returnFileContentAfterWrite: args.returnFileContentAfterWrite,
      },
      piResult,
    );
  }

  /** Binary write via `bash` base64 decoding. */
  private async executeBinaryWrite(
    toolCallId: string,
    args: WriteArgs,
  ): Promise<WriteResult> {
    if (!this.ctx.getActiveTools().has("bash")) {
      return buildWriteRejectedResult(args.path, "Tool not available");
    }

    if (!args.fileBytes || args.fileBytes.length === 0) {
      return buildWriteRejectedResult(args.path, "No file bytes provided");
    }

    const base64 = Buffer.from(args.fileBytes).toString("base64");
    const command = buildBase64WriteCommand(args.path, base64);

    const piResult = await requestToolExecution(
      this.ctx.getChannel?.() ?? null,
      {
        toolCallId,
        cursorExecType: "write-binary",
        piToolName: "bash",
        piToolArgs: { command },
      },
    );

    return buildWriteResultFromToolResult(
      {
        path: args.path,
        fileBytes: args.fileBytes,
        returnFileContentAfterWrite: args.returnFileContentAfterWrite,
      },
      piResult,
    );
  }
}
