import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type {
  ImageContent,
  TextContent,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export interface ToolExecStartEvent {
  type: "start";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolExecEndEvent {
  type: "end";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: ToolResultMessage;
}

export type ToolExecEvent = ToolExecStartEvent | ToolExecEndEvent;

export interface PiToolContext {
  readonly cwd: string;
  readonly signal?: AbortSignal;
  getActiveTools(): Set<string>;
  getCtx(): ExtensionContext | null;
  onToolExec?(event: ToolExecEvent): void;
}

interface ExecutableTool<TArgs extends Record<string, unknown>> {
  execute(
    toolCallId: string,
    params: TArgs,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<unknown>>;
}

export function decodeToolCallId(toolCallId: string | undefined): string {
  return toolCallId && toolCallId.length > 0 ? toolCallId : crypto.randomUUID();
}

export function createToolResultMessage(
  toolCallId: string,
  toolName: string,
  result: AgentToolResult<unknown>,
  isError: boolean,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: result.content as (TextContent | ImageContent)[],
    details: result.details,
    isError,
    timestamp: Date.now(),
  };
}

export function buildErrorResult(message: string): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: message }],
    details: undefined,
  };
}

export async function executePiTool<TArgs extends Record<string, unknown>>(
  ctx: PiToolContext,
  tool: ExecutableTool<TArgs>,
  toolName: string,
  toolCallId: string,
  args: TArgs,
): Promise<ToolResultMessage> {
  const extCtx = ctx.getCtx();
  if (extCtx?.hasUI) {
    extCtx.ui.setWorkingMessage(`Cursor: ${toolName}`);
    extCtx.ui.setStatus(
      "cursor-agent",
      `${toolName}: ${JSON.stringify(args).slice(0, 200)}`,
    );
  }
  ctx.onToolExec?.({ type: "start", toolCallId, toolName, args });

  let result: AgentToolResult<unknown>;
  let isError = false;
  try {
    result = await tool.execute(toolCallId, args, ctx.signal);
  } catch (error) {
    isError = true;
    result = buildErrorResult(
      error instanceof Error ? error.message : String(error),
    );
  }

  const toolResult = createToolResultMessage(
    toolCallId,
    toolName,
    result,
    isError,
  );
  ctx.onToolExec?.({
    type: "end",
    toolCallId,
    toolName,
    args,
    result: toolResult,
  });

  if (extCtx?.hasUI) {
    extCtx.ui.setWorkingMessage();
    extCtx.ui.setStatus("cursor-agent", undefined);
  }

  return toolResult;
}
