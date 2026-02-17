import type { TextContent } from "@mariozechner/pi-ai";
import type { StreamExecutor } from "../../vendor/agent-exec";
import type {
  ShellArgs,
  ShellStream,
} from "../../__generated__/agent/v1/shell_exec_pb";
import {
  ShellStream as ShellStreamClass,
  ShellRejected,
  ShellStreamExit,
  ShellStreamStart,
  ShellStreamStderr,
  ShellStreamStdout,
} from "../../__generated__/agent/v1/shell_exec_pb";
import { type PiToolContext, decodeToolCallId, executePiTool } from "../local-resource-provider/types";
import { type LocalShellExecutor, confirmIfDangerous } from "./shell";

export class LocalShellStreamExecutor implements StreamExecutor<
  ShellArgs,
  ShellStream
> {
  private readonly ctx: PiToolContext;
  private readonly shellExecutor: LocalShellExecutor;

  constructor(ctx: PiToolContext, shellExecutor: LocalShellExecutor) {
    this.ctx = ctx;
    this.shellExecutor = shellExecutor;
  }

  execute(_ctx: unknown, args: ShellArgs): AsyncIterable<ShellStream> {
    return this.run(args);
  }

  private async *run(args: ShellArgs): AsyncIterable<ShellStream> {
    const toolCallId = decodeToolCallId(args.toolCallId);
    const cwd = args.workingDirectory || this.ctx.cwd;

    if (!this.ctx.getActiveTools().has("bash")) {
      yield new ShellStreamClass({
        event: {
          case: "rejected",
          value: new ShellRejected({
            command: args.command,
            workingDirectory: args.workingDirectory,
            reason: "Tool not available",
            isReadonly: false,
          }),
        },
      });
      yield new ShellStreamClass({
        event: {
          case: "exit",
          value: new ShellStreamExit({ code: 1, cwd, aborted: false }),
        },
      });
      return;
    }

    const approved = await confirmIfDangerous(this.ctx.getCtx, args.command);
    if (!approved) {
      yield new ShellStreamClass({
        event: {
          case: "rejected",
          value: new ShellRejected({
            command: args.command,
            workingDirectory: args.workingDirectory,
            reason: "Command rejected",
            isReadonly: false,
          }),
        },
      });
      yield new ShellStreamClass({
        event: {
          case: "exit",
          value: new ShellStreamExit({ code: 1, cwd, aborted: false }),
        },
      });
      return;
    }

    yield new ShellStreamClass({
      event: { case: "start", value: new ShellStreamStart({}) },
    });

    const timeoutSeconds =
      args.timeout && args.timeout > 0 ? args.timeout : undefined;
    const bashTool = this.shellExecutor.getBashTool(
      args.workingDirectory || undefined,
    );

    const toolResult = await executePiTool(
      this.ctx,
      bashTool,
      "bash",
      toolCallId,
      { command: args.command, timeout: timeoutSeconds },
    );

    const text = toolResult.content
      .filter((c): c is TextContent => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    if (toolResult.isError) {
      yield new ShellStreamClass({
        event: {
          case: "stderr",
          value: new ShellStreamStderr({ data: text || "Shell failed" }),
        },
      });
      yield new ShellStreamClass({
        event: {
          case: "exit",
          value: new ShellStreamExit({ code: 1, cwd, aborted: false }),
        },
      });
      return;
    }

    if (text) {
      yield new ShellStreamClass({
        event: {
          case: "stdout",
          value: new ShellStreamStdout({ data: text }),
        },
      });
    }

    yield new ShellStreamClass({
      event: {
        case: "exit",
        value: new ShellStreamExit({ code: 0, cwd, aborted: false }),
      },
    });
  }
}
