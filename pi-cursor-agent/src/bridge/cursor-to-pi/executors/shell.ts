import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type {
  ShellArgs,
  ShellResult,
} from "../../../__generated__/agent/v1/shell_exec_pb";
import {
  ShellFailure,
  ShellRejected,
  ShellResult as ShellResultClass,
  ShellSuccess,
} from "../../../__generated__/agent/v1/shell_exec_pb";
import type { Executor } from "../../../vendor/agent-exec";
import { toolResultToText } from "../../shared/tool-result";
import {
  decodeToolCallId,
  type PiToolContext,
} from "../local-resource-provider/types";
import { requestToolExecution, shellQuote } from "../tool-bridge";

export function buildScopedShellCommand(
  command: string,
  workingDirectory: string | undefined,
  defaultCwd: string,
): string {
  if (!workingDirectory || workingDirectory === defaultCwd) {
    return command;
  }
  return `cd ${shellQuote(workingDirectory)} && {\n${command}\n}`;
}

export function buildShellResultFromToolResult(
  args: { command: string; workingDirectory: string },
  result: ToolResultMessage,
): ShellResult {
  const output = toolResultToText(result);
  if (result.isError) {
    return new ShellResultClass({
      result: {
        case: "failure",
        value: new ShellFailure({
          command: args.command,
          workingDirectory: args.workingDirectory,
          exitCode: 1,
          signal: "",
          stdout: "",
          stderr: output || "Shell failed",
          executionTime: 0,
          aborted: false,
        }),
      },
    });
  }
  return new ShellResultClass({
    result: {
      case: "success",
      value: new ShellSuccess({
        command: args.command,
        workingDirectory: args.workingDirectory,
        exitCode: 0,
        signal: "",
        stdout: output,
        stderr: "",
        executionTime: 0,
      }),
    },
  });
}

export function buildShellRejectedResult(
  command: string,
  workingDirectory: string,
  reason: string,
): ShellResult {
  return new ShellResultClass({
    result: {
      case: "rejected",
      value: new ShellRejected({
        command,
        workingDirectory,
        reason,
        isReadonly: false,
      }),
    },
  });
}

function isDangerousShellCommand(command: string): boolean {
  const c = command.toLowerCase();
  if (/(^|\s)sudo\b/.test(c)) return true;
  if (/\brm\b.*\s-rf\b/.test(c)) return true;
  if (/\bmkfs\b|\bdd\b|\bshutdown\b|\breboot\b/.test(c)) return true;
  if (/\bcurl\b.*\|\s*(sh|bash)\b/.test(c)) return true;
  if (/\bwget\b.*\|\s*(sh|bash)\b/.test(c)) return true;
  return false;
}

export async function confirmIfDangerous(
  getCtx: () => ExtensionContext | null,
  command: string,
): Promise<boolean> {
  if (!isDangerousShellCommand(command)) return true;
  const ctx = getCtx();
  if (!ctx?.hasUI) return false;
  return ctx.ui.confirm("Cursor command approval", command);
}

export class LocalShellExecutor implements Executor<ShellArgs, ShellResult> {
  private readonly ctx: PiToolContext;

  constructor(ctx: PiToolContext) {
    this.ctx = ctx;
  }

  async execute(_ctx: unknown, args: ShellArgs): Promise<ShellResult> {
    const toolCallId = decodeToolCallId(args.toolCallId);
    const workingDirectory = args.workingDirectory || this.ctx.cwd;

    if (!this.ctx.getActiveTools().has("bash")) {
      return buildShellRejectedResult(
        args.command,
        workingDirectory,
        "Tool not available",
      );
    }

    const approved = await confirmIfDangerous(this.ctx.getCtx, args.command);
    if (!approved) {
      return buildShellRejectedResult(
        args.command,
        workingDirectory,
        "Command rejected",
      );
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
        cursorExecType: "shell",
        piToolName: "bash",
        piToolArgs: {
          command,
          ...(timeoutSeconds != null ? { timeout: timeoutSeconds } : {}),
        },
      },
    );

    return buildShellResultFromToolResult(
      { command: args.command, workingDirectory },
      piResult,
    );
  }
}
