import { type JsonValue, Value } from "@bufbuild/protobuf";
import type {
  Api,
  AssistantMessage,
  Context,
  ImageContent,
  Message,
  Model,
  TextContent,
  Tool,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import {
  AgentClientMessage,
  AgentRunRequest,
  ConversationAction,
  type ConversationStateStructure,
  ConversationStateStructure as ConversationStateStructureClass,
  ConversationTurnStructure,
  ModelDetails,
  UserMessage,
  UserMessageAction,
} from "../../__generated__/agent/v1/agent_pb";
import {
  type McpToolDefinition,
  McpToolDefinition as McpToolDefinitionClass,
  McpTools,
} from "../../__generated__/agent/v1/mcp_pb";
import type { CursorStateStore } from "../../provider/state";
import { type BlobStore, getBlobId } from "../../vendor/agent-kv";
import { toolResultToText } from "../shared/tool-result";
import {
  extractContextTools,
  extractPiSystemState,
  getNonSystemMessages,
} from "./transcript";

const CURSOR_NATIVE_TOOL_NAMES = new Set([
  "bash",
  "read",
  "write",
  "delete",
  "ls",
  "grep",
  "lsp",
  "todo_write",
]);

const DEFAULT_TOOL_SCHEMA: JsonValue = {
  type: "object",
  properties: {},
  required: [],
};

const MAX_RECONSTRUCTED_ARGS_CHARS = 600;
const MAX_RECONSTRUCTED_TOOL_RESULT_CHARS = 12_000;

function extractUserMessageText(msg: Message): string {
  if (msg.role !== "user") return "";
  if (typeof msg.content === "string") return msg.content.trim();
  const parts: string[] = [];
  for (const item of msg.content as Array<TextContent | ImageContent>) {
    if (item.type === "text" && item.text) {
      parts.push(item.text);
    } else if (item.type === "image") {
      parts.push(`[${item.mimeType || "image"} attached]`);
    }
  }
  return parts.join("\n").trim();
}

function summarizeToolArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  try {
    const serialized = JSON.stringify(args);
    if (!serialized || serialized === "{}") return "";
    if (serialized.length <= MAX_RECONSTRUCTED_ARGS_CHARS) return serialized;
    return `${serialized.slice(0, MAX_RECONSTRUCTED_ARGS_CHARS)}…`;
  } catch {
    return "";
  }
}

/** Format assistant content blocks (text and toolCall; omitting internal thinking). */
function formatContentBlocks(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    switch (b["type"]) {
      case "text":
        if (b["text"]) parts.push(String(b["text"]));
        break;
      case "toolCall": {
        const name = String(b["name"] || "unknown");
        const argsSummary = summarizeToolArgs(b["arguments"]);
        parts.push(
          argsSummary ? `[Tool: ${name} ${argsSummary}]` : `[Tool: ${name}]`,
        );
        break;
      }
    }
  }
  return parts.join("\n\n");
}

/** Reconstruct assistant text from stored content or Pi message blocks. */
function reconstructAssistantText(
  msg: AssistantMessage,
  state: CursorStateStore | undefined,
): string {
  const stored = state?.getAssistantContent(msg.timestamp);
  if (stored && stored.blocks.length > 0) {
    const formatted = formatContentBlocks(stored.blocks);
    if (formatted) return formatted;
  }
  if (!Array.isArray(msg.content)) return "";
  return formatContentBlocks(msg.content as unknown[]);
}

/** Format a tool result with exec-type label from stored metadata. */
function formatToolResultStep(
  msg: ToolResultMessage,
  state: CursorStateStore | undefined,
): string {
  const rawText = toolResultToText(msg) || "(no output)";
  const text =
    rawText.length > MAX_RECONSTRUCTED_TOOL_RESULT_CHARS
      ? `${rawText.slice(0, MAX_RECONSTRUCTED_TOOL_RESULT_CHARS)}\n… [truncated ${rawText.length - MAX_RECONSTRUCTED_TOOL_RESULT_CHARS} chars]`
      : rawText;
  const meta = state?.getToolCallMeta(msg.toolCallId);
  const label = meta
    ? meta.cursorExecType === "mcp"
      ? meta.piToolName
      : meta.cursorExecType
    : msg.toolName || "Tool";
  const status = msg.isError ? "error" : "result";
  return `[${label} ${status}]\n${text}`;
}

async function storeBlob(
  blobStore: BlobStore,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const blobId = getBlobId(bytes);
  await blobStore.setBlob(null, blobId, bytes);
  return new Uint8Array(Array.from(blobId));
}

function getPriorMessages(
  nonSystemMessages: Message[],
  excludeFinalUserMessage: boolean,
): Message[] {
  if (!excludeFinalUserMessage) {
    return nonSystemMessages;
  }
  for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
    if (nonSystemMessages[i]?.role === "user") {
      return nonSystemMessages.slice(0, i);
    }
  }
  return nonSystemMessages;
}

/**
 * Format prior conversation turns into a clean transcript block for cold
 * reconstruction (after `/fork`, cache eviction, compaction, tree jump, or
 * cross-provider switches).
 *
 * Passing this on a fresh Cursor `ConversationStateStructure` (`rootPromptMessagesJson`
 * length 1) ensures Cursor still injects its full system prompt, `<rules>`,
 * `<agent_skill>`, and `pi-agent` tools while preserving the entire prior conversation.
 */
export function formatPriorConversationHistory(
  priorMessages: Message[],
  state: CursorStateStore | undefined,
): string {
  if (priorMessages.length === 0) return "";

  const entries: string[] = [];
  for (const msg of priorMessages) {
    if (msg.role === "user") {
      const text = extractUserMessageText(msg);
      if (text) {
        entries.push(`<turn role="user">\n${text}\n</turn>`);
      }
    } else if (msg.role === "assistant") {
      const text = reconstructAssistantText(msg as AssistantMessage, state);
      if (text) {
        entries.push(`<turn role="assistant">\n${text}\n</turn>`);
      }
    } else if (msg.role === "toolResult") {
      const text = formatToolResultStep(msg as ToolResultMessage, state);
      if (text) {
        entries.push(`<turn role="tool">\n${text}\n</turn>`);
      }
    }
  }

  if (entries.length === 0) return "";

  return [
    "<prior_conversation_history>",
    "Earlier turns in this session (reconstructed from the Pi session transcript; treat these as prior conversation history):",
    ...entries,
    "</prior_conversation_history>",
  ].join("\n\n");
}

function countPriorUserTurns(priorMessages: Message[]): number {
  let count = 0;
  for (const msg of priorMessages) {
    if (msg.role === "user" && extractUserMessageText(msg)) {
      count++;
    }
  }
  return count;
}

function findLastAssistantMessage(
  messages: Message[],
): AssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "assistant") {
      return msg as AssistantMessage;
    }
  }
  return undefined;
}

/**
 * Verify that a cached Cursor ConversationStateStructure is still backed by
 * blobs in `blobStore` and aligned with Pi's current transcript branch.
 * Returns false after `/fork`, cache eviction, compaction, tree switch, or
 * non-Cursor turns so history is cleanly reconstructed instead of dropped.
 */
export async function canReuseConversationState(
  cached: ConversationStateStructure | undefined,
  blobStore: BlobStore,
  nonSystemMessages: Message[],
  excludeFinalUserMessage: boolean,
  expectedLastAssistantTimestamp?: number,
): Promise<boolean> {
  if (
    !cached ||
    cached.rootPromptMessagesJson.length === 0 ||
    cached.turns.length === 0
  ) {
    return false;
  }

  const priorMessages = getPriorMessages(
    nonSystemMessages,
    excludeFinalUserMessage,
  );
  if (priorMessages.length === 0) {
    return false;
  }

  const lastAssistant = findLastAssistantMessage(priorMessages);
  if (!lastAssistant) {
    return false;
  }

  // If the most recent assistant message wasn't from cursor-agent, cached state is stale.
  if (lastAssistant.provider && lastAssistant.provider !== "cursor-agent") {
    return false;
  }

  if (expectedLastAssistantTimestamp !== undefined) {
    // Exact branch alignment check: if another turn, compaction, or tree switch happened,
    // the latest assistant timestamp will not match our last flushed Cursor turn.
    if (lastAssistant.timestamp !== expectedLastAssistantTimestamp) {
      return false;
    }
  } else {
    // Legacy fallback (snapshots written before lastAssistantTimestamp existed):
    const priorTurnCount = countPriorUserTurns(priorMessages);
    if (priorTurnCount === 0 || cached.turns.length !== priorTurnCount) {
      return false;
    }
    for (const msg of priorMessages) {
      if (
        msg.role === "assistant" &&
        msg.provider &&
        msg.provider !== "cursor-agent"
      ) {
        return false;
      }
    }
  }

  // Verify every root prompt blob exists in blobStore.
  for (const rootBlobId of cached.rootPromptMessagesJson) {
    const bytes = await blobStore.getBlob(null, rootBlobId);
    if (!bytes || bytes.length === 0) {
      return false;
    }
  }

  // Verify every turn blob and its referenced userMessage/step blobs exist.
  for (const turnBlobId of cached.turns) {
    const turnBytes = await blobStore.getBlob(null, turnBlobId);
    if (!turnBytes || turnBytes.length === 0) {
      return false;
    }
    try {
      const turn = ConversationTurnStructure.fromBinary(turnBytes);
      if (turn.turn.case === "agentConversationTurn") {
        const agentTurn = turn.turn.value;
        if (agentTurn.userMessage.length > 0) {
          const userBytes = await blobStore.getBlob(
            null,
            agentTurn.userMessage,
          );
          if (!userBytes || userBytes.length === 0) {
            return false;
          }
        }
        for (const stepBlobId of agentTurn.steps) {
          const stepBytes = await blobStore.getBlob(null, stepBlobId);
          if (!stepBytes || stepBytes.length === 0) {
            return false;
          }
        }
      }
    } catch {
      return false;
    }
  }

  return true;
}

function sanitizeJsonSchema(parameters: unknown): JsonValue {
  if (!parameters || typeof parameters !== "object") {
    return DEFAULT_TOOL_SCHEMA;
  }
  try {
    const roundTripped = JSON.parse(JSON.stringify(parameters)) as JsonValue;
    if (
      roundTripped &&
      typeof roundTripped === "object" &&
      !Array.isArray(roundTripped)
    ) {
      return roundTripped;
    }
  } catch {
    // Fall back to empty object schema below.
  }
  return DEFAULT_TOOL_SCHEMA;
}

function encodeToolSchema(parameters: unknown): Uint8Array<ArrayBuffer> {
  const schemaValue = sanitizeJsonSchema(parameters);
  try {
    return new Uint8Array(Array.from(Value.fromJson(schemaValue).toBinary()));
  } catch {
    return new Uint8Array(
      Array.from(Value.fromJson(DEFAULT_TOOL_SCHEMA).toBinary()),
    );
  }
}

export function buildMcpToolDefinitions(
  tools: Tool[] | undefined,
): McpToolDefinition[] {
  if (!tools || tools.length === 0) {
    return [];
  }

  const advertisedTools = tools.filter(
    (tool) => !CURSOR_NATIVE_TOOL_NAMES.has(tool.name),
  );
  if (advertisedTools.length === 0) {
    return [];
  }

  return advertisedTools.map((tool) => {
    return new McpToolDefinitionClass({
      name: tool.name,
      description: tool.description ?? "",
      providerIdentifier: "pi-agent",
      toolName: tool.name,
      inputSchema: encodeToolSchema(tool.parameters),
    });
  });
}

interface BuildRunRequestParams {
  model: Model<Api>;
  context: Context;
  conversationId: string;
  blobStore: BlobStore;
  conversationState: ConversationStateStructure | undefined;
  mcpToolDefinitions?: McpToolDefinition[];
  state?: CursorStateStore;
  systemPromptOverride?: string;
  expectedLastAssistantTimestamp?: number;
}

interface BuildRunRequestResult {
  initialRequest: AgentClientMessage;
  conversationState: ConversationStateStructure;
}

export async function buildRunRequest(
  params: BuildRunRequestParams,
): Promise<BuildRunRequestResult> {
  const content =
    params.systemPromptOverride ||
    extractPiSystemState(params.context).fullText ||
    "You are a helpful assistant.";

  const systemPromptJson = JSON.stringify({
    role: "system",
    content,
  });
  const systemPromptBytes = new TextEncoder().encode(systemPromptJson);
  const systemPromptId = await storeBlob(params.blobStore, systemPromptBytes);

  const nonSystemMessages = getNonSystemMessages(params.context.messages);
  const lastMessage = nonSystemMessages.at(-1);

  let userText = "";
  let excludeFinalUserMessage = true;

  if (lastMessage?.role === "user") {
    userText = extractUserMessageText(lastMessage);
  } else if (lastMessage) {
    excludeFinalUserMessage = false;
    userText = "Continue based on the preceding conversation and tool results.";
  }

  if (!userText) {
    throw new Error("Cannot send empty user message to Cursor API");
  }

  const cached = params.conversationState;
  const reuseCached = await canReuseConversationState(
    cached,
    params.blobStore,
    nonSystemMessages,
    excludeFinalUserMessage,
    params.expectedLastAssistantTimestamp,
  );

  let conversationState: ConversationStateStructure;
  let effectiveUserText = userText;

  if (reuseCached && cached) {
    conversationState = cached;
  } else {
    const priorMessages = getPriorMessages(
      nonSystemMessages,
      excludeFinalUserMessage,
    );
    const historyBlock = formatPriorConversationHistory(
      priorMessages,
      params.state,
    );
    if (historyBlock) {
      effectiveUserText = `${historyBlock}\n\n${userText}`;
    }

    conversationState = new ConversationStateStructureClass({
      rootPromptMessagesJson: [systemPromptId as Uint8Array<ArrayBuffer>],
      turns: [],
      todos: [],
      pendingToolCalls: [],
      previousWorkspaceUris: [],
      fileStates: {},
      fileStatesV2: {},
      summaryArchives: [],
      turnTimings: [],
      subagentStates: {},
      selfSummaryCount: 0,
      readPaths: [],
    });
  }

  const userMessage = new UserMessage({
    text: effectiveUserText,
    messageId: crypto.randomUUID(),
  });

  const action = new ConversationAction({
    action: {
      case: "userMessageAction",
      value: new UserMessageAction({ userMessage }),
    },
  });

  const modelDetails = new ModelDetails({
    modelId: params.model.id,
    displayModelId: params.model.id,
    displayName: params.model.name,
  });

  const mcpToolDefinitions = params.mcpToolDefinitions ?? [];
  const runRequest = new AgentRunRequest({
    conversationState,
    action,
    modelDetails,
    conversationId: params.conversationId,
    mcpTools: new McpTools({ mcpTools: mcpToolDefinitions }),
  });

  const initialRequest = new AgentClientMessage({
    message: { case: "runRequest", value: runRequest },
  });

  return {
    initialRequest,
    conversationState,
  };
}

export function getContextTools(context: Context): McpToolDefinition[] {
  return buildMcpToolDefinitions(extractContextTools(context));
}
