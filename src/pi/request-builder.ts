import type {
  Api,
  Context,
  Message,
  Model,
  TextContent,
  Tool,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import {
  AgentClientMessage,
  AgentConversationTurnStructure,
  AgentRunRequest,
  AssistantMessage as AssistantMessageProto,
  ConversationAction,
  type ConversationStateStructure,
  ConversationStep,
  ConversationTurnStructure,
  ModelDetails,
  UserMessage,
  UserMessageAction,
  ConversationStateStructure as ConversationStateStructureClass,
} from "../__generated__/agent/v1/agent_pb";
import {
  type McpToolDefinition,
  McpToolDefinition as McpToolDefinitionClass,
} from "../__generated__/agent/v1/mcp_pb";
import { toolResultToText } from "./utils/tool-result";
import { getBlobId, type BlobStore } from "../vendor/agent-kv";

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

type ContextWithTools = Context & { tools?: Tool[] };

export function extractUserMessageText(msg: Message): string {
  if (msg.role !== "user") return "";
  if (typeof msg.content === "string") return msg.content.trim();
  return msg.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

export function extractAssistantMessageText(msg: Message): string {
  if (msg.role !== "assistant") return "";
  if (!Array.isArray(msg.content)) return "";
  return msg.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export function buildConversationTurns(messages: Message[]): Uint8Array[] {
  const turns: Uint8Array[] = [];

  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (!msg || msg.role !== "user") {
      i++;
      continue;
    }

    let isLastUserMessage = true;
    for (let j = i + 1; j < messages.length; j++) {
      if (messages[j]?.role === "user") {
        isLastUserMessage = false;
        break;
      }
    }
    if (isLastUserMessage) break;

    const userText = extractUserMessageText(msg);
    if (!userText) {
      i++;
      continue;
    }

    const userMessage = new UserMessage({
      text: userText,
      messageId: crypto.randomUUID(),
    });
    const userMessageBytes = userMessage.toBinary();

    const stepBytes: Uint8Array[] = [];
    i++;
    while (i < messages.length && messages[i]?.role !== "user") {
      const stepMsg = messages[i];
      if (!stepMsg) {
        i++;
        continue;
      }

      if (stepMsg.role === "assistant") {
        const text = extractAssistantMessageText(stepMsg);
        if (text) {
          const step = new ConversationStep({
            message: {
              case: "assistantMessage",
              value: new AssistantMessageProto({ text }),
            },
          });
          stepBytes.push(step.toBinary());
        }
      } else if (stepMsg.role === "toolResult") {
        const text = toolResultToText(stepMsg as ToolResultMessage);
        if (text) {
          const step = new ConversationStep({
            message: {
              case: "assistantMessage",
              value: new AssistantMessageProto({
                text: `[Tool Result]\n${text}`,
              }),
            },
          });
          stepBytes.push(step.toBinary());
        }
      }

      i++;
    }

    const agentTurn = new AgentConversationTurnStructure({
      userMessage: new Uint8Array(userMessageBytes),
      steps: stepBytes,
    });
    const turn = new ConversationTurnStructure({
      turn: { case: "agentConversationTurn", value: agentTurn },
    });
    turns.push(turn.toBinary());
  }

  return turns;
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
    const jsonSchema = tool.parameters as Record<string, unknown> | undefined;
    const schemaValue =
      jsonSchema && typeof jsonSchema === "object"
        ? jsonSchema
        : { type: "object", properties: {}, required: [] };
    const inputSchema = new TextEncoder().encode(JSON.stringify(schemaValue));
    return new McpToolDefinitionClass({
      name: tool.name,
      description: tool.description,
      providerIdentifier: "pi-agent",
      toolName: tool.name,
      inputSchema,
    });
  });
}

export interface BuildRunRequestParams {
  model: Model<Api>;
  context: Context;
  conversationId: string;
  blobStore: BlobStore;
  conversationState: ConversationStateStructure | undefined;
}

export interface BuildRunRequestResult {
  initialRequest: AgentClientMessage;
  conversationState: ConversationStateStructure;
}

export function buildRunRequest(
  params: BuildRunRequestParams,
): BuildRunRequestResult {
  const systemPromptJson = JSON.stringify({
    role: "system",
    content: params.context.systemPrompt || "You are a helpful assistant.",
  });
  const systemPromptBytes = new TextEncoder().encode(systemPromptJson);
  const systemPromptId = getBlobId(systemPromptBytes);
  void params.blobStore.setBlob(null, systemPromptId, systemPromptBytes);

  const lastMessage = params.context.messages.at(-1);
  const userText = lastMessage ? extractUserMessageText(lastMessage) : "";
  if (!userText) {
    throw new Error("Cannot send empty user message to Cursor API");
  }

  const userMessage = new UserMessage({
    text: userText,
    messageId: crypto.randomUUID(),
  });

  const action = new ConversationAction({
    action: {
      case: "userMessageAction",
      value: new UserMessageAction({ userMessage }),
    },
  });

  const cached = params.conversationState;
  const hasMatchingPrompt = cached?.rootPromptMessagesJson?.some((entry) =>
    Buffer.from(entry).equals(systemPromptId),
  );

  const turns = buildConversationTurns(params.context.messages);

  const baseState =
    cached && hasMatchingPrompt
      ? cached
      : new ConversationStateStructureClass({
          rootPromptMessagesJson: [systemPromptId],
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

  const conversationState = new ConversationStateStructureClass({
    ...baseState,
    turns: turns.length > 0 ? turns : baseState.turns,
  });

  const modelDetails = new ModelDetails({
    modelId: params.model.id,
    displayModelId: params.model.id,
    displayName: params.model.name,
  });

  const runRequest = new AgentRunRequest({
    conversationState,
    action,
    modelDetails,
    conversationId: params.conversationId,
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
  return buildMcpToolDefinitions((context as ContextWithTools).tools);
}
