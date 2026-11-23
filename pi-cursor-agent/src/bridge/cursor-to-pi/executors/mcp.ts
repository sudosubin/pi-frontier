import { Value } from "@bufbuild/protobuf";
import type {
  ImageContent,
  TextContent,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import type {
  McpArgs,
  McpResult,
} from "../../../__generated__/agent/v1/mcp_tool_pb";
import {
  McpError,
  McpImageContent,
  McpResult as McpResultClass,
  McpSuccess,
  McpTextContent,
  McpToolNotFound,
  McpToolResultContentItem,
} from "../../../__generated__/agent/v1/mcp_tool_pb";
import type { Executor } from "../../../vendor/agent-exec";
import {
  decodeToolCallId,
  type PiToolContext,
} from "../local-resource-provider/types";
import { requestToolExecution } from "../tool-bridge";

/**
 * Decode a single MCP arg value from bytes.
 * Cursor encodes arg values as protobuf Value binary; fall back to raw JSON.
 */
function decodeMcpArgValue(bytes: Uint8Array): unknown {
  try {
    return Value.fromBinary(bytes).toJson();
  } catch {
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return new TextDecoder().decode(bytes);
    }
  }
}

/** Decode all MCP args from map<string, bytes> to a plain object. */
function decodeMcpArgs(args: {
  [key: string]: Uint8Array;
}): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    result[key] = decodeMcpArgValue(value);
  }
  return result;
}

/** Resolve the Pi tool name from Cursor's McpArgs (`toolName` or prefixed `name`). */
export function resolveMcpToolName(
  args: Pick<McpArgs, "name" | "toolName" | "providerIdentifier">,
): string {
  if (args.toolName) return args.toolName;
  if (!args.name) return "";
  const prefix = `${args.providerIdentifier || "pi-agent"}-`;
  if (args.name.startsWith(prefix)) {
    return args.name.slice(prefix.length);
  }
  return args.name;
}

/** Convert a Pi ToolResultMessage (including text and image blocks) to a Cursor McpResult. */
export function buildMcpResultFromToolResult(
  result: ToolResultMessage,
): McpResult {
  const items: McpToolResultContentItem[] = [];

  for (const block of result.content as Array<TextContent | ImageContent>) {
    if (block.type === "text") {
      items.push(
        new McpToolResultContentItem({
          content: {
            case: "text",
            value: new McpTextContent({ text: block.text }),
          },
        }),
      );
    } else if (block.type === "image" && block.data) {
      items.push(
        new McpToolResultContentItem({
          content: {
            case: "image",
            value: new McpImageContent({
              data: new Uint8Array(Buffer.from(block.data, "base64")),
              mimeType: block.mimeType || "image/png",
            }),
          },
        }),
      );
    }
  }

  if (items.length === 0) {
    items.push(
      new McpToolResultContentItem({
        content: {
          case: "text",
          value: new McpTextContent({ text: "(no output)" }),
        },
      }),
    );
  }

  return new McpResultClass({
    result: {
      case: "success",
      value: new McpSuccess({
        content: items,
        isError: result.isError,
      }),
    },
  });
}

export class LocalMcpExecutor implements Executor<McpArgs, McpResult> {
  private readonly ctx: PiToolContext;
  private readonly declaredToolNames: ReadonlySet<string>;

  constructor(
    ctx: PiToolContext,
    declaredToolNames: ReadonlySet<string> = new Set(),
  ) {
    this.ctx = ctx;
    this.declaredToolNames = declaredToolNames;
  }

  async execute(_ctx: unknown, args: McpArgs): Promise<McpResult> {
    const toolCallId = decodeToolCallId(args.toolCallId);
    const toolName = resolveMcpToolName(args);

    if (!toolName) {
      return new McpResultClass({
        result: {
          case: "error",
          value: new McpError({ error: "No tool name provided" }),
        },
      });
    }

    const activeTools = this.ctx.getActiveTools();
    if (!activeTools.has(toolName) && !this.declaredToolNames.has(toolName)) {
      const availableTools = Array.from(
        new Set([...activeTools, ...this.declaredToolNames]),
      );
      return new McpResultClass({
        result: {
          case: "toolNotFound",
          value: new McpToolNotFound({
            name: toolName,
            availableTools,
          }),
        },
      });
    }

    const piToolArgs = decodeMcpArgs(args.args);

    try {
      const piResult = await requestToolExecution(
        this.ctx.getChannel?.() ?? null,
        {
          toolCallId,
          cursorExecType: "mcp",
          piToolName: toolName,
          piToolArgs,
        },
      );
      return buildMcpResultFromToolResult(piResult);
    } catch (error) {
      return new McpResultClass({
        result: {
          case: "error",
          value: new McpError({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      });
    }
  }
}
