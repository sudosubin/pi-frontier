import type {
  ShellArgs,
  ShellStream,
} from "../../../__generated__/agent/v1/shell_exec_pb";
import {
  ShellRejected,
  ShellStream as ShellStreamClass,
  ShellStreamExit,
  ShellStreamStderr,
  ShellStreamStdout,
} from "../../../__generated__/agent/v1/shell_exec_pb";
import type { StreamExecutor } from "../../../vendor/agent-exec";
import { toolResultToText } from "../../shared/tool-result";
import {
  decodeToolCallId,
  type PiToolContext,
} from "../local-resource-provider/types";
import { requestToolExecution } from "../tool-bridge";
import { buildScopedShellCommand, confirmIfDangerous } from "./shell";

export class LocalShellStreamExecutor
  implements StreamExecutor<ShellArgs, ShellStream>
{
  private readonly ctx: PiToolContext;

  constructor(ctx: PiToolContext) {
    this.ctx = ctx;
  }

  async *execute(_ctx: unknown, args: ShellArgs): AsyncIterable<ShellStream> {
    const toolCallId = decodeToolCallId(args.toolCallId);
    const workingDirectory = args.workingDirectory || this.ctx.cwd;

    if (!this.ctx.getActiveTools().has("bash")) {
      yield new ShellStreamClass({
        event: {
          case: "rejected",
          value: new ShellRejected({
            command: args.command,
            workingDirectory,
            reason: "Tool not available",
            isReadonly: false,
          }),
        },
      });
      yield new ShellStreamClass({
        event: {
          case: "exit",
          value: new ShellStreamExit({
            code: 1,
            cwd: workingDirectory,
            aborted: false,
          }),
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
            workingDirectory,
            reason: "Command rejected",
            isReadonly: false,
          }),
        },
      });
      yield new ShellStreamClass({
        event: {
          case: "exit",
          value: new ShellStreamExit({
            code: 1,
            cwd: workingDirectory,
            aborted: false,
          }),
        },
      });
      return;
    }

    const timeoutSeconds =
      args.timeout && args.timeout > 0 ? args.timeout : undefined;
    const command = buildScopedShellCommand(
      args.command,
      args.workingDirectory,
      this.ctx.cwd,
    );

    const piResult = await requestToolExecution(
      this.ctx.getChannel?.() ?? null,
      {
        toolCallId,
        cursorExecType: "shell-stream",
        piToolName: "bash",
        piToolArgs: {
          command,
          ...(timeoutSeconds != null ? { timeout: timeoutSeconds } : {}),
        },
      },
    );

    const text = toolResultToText(piResult);
    if (text) {
      if (piResult.isError) {
        yield new ShellStreamClass({
          event: {
            case: "stderr",
            value: new ShellStreamStderr({ data: text }),
          },
        });
      } else {
        yield new ShellStreamClass({
          event: {
            case: "stdout",
            value: new ShellStreamStdout({ data: text }),
          },
        });
      }
    }

    yield new ShellStreamClass({
      event: {
        case: "exit",
        value: new ShellStreamExit({
          code: piResult.isError ? 1 : 0,
          cwd: workingDirectory,
        }),
      },
    });
  }
}
