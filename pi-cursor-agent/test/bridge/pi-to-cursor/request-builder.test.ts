import assert from "node:assert/strict";
import test from "node:test";
import type { Context, Message, Model } from "@mariozechner/pi-ai";
import {
  AgentConversationTurnStructure,
  ConversationStateStructure,
  ConversationTurnStructure,
  UserMessage,
} from "../../../src/__generated__/agent/v1/agent_pb.js";
import {
  buildMcpToolDefinitions,
  buildRunRequest,
  canReuseConversationState,
} from "../../../src/bridge/pi-to-cursor/request-builder.js";
import { createStateStore } from "../../../src/provider/state.js";
import {
  getBlobId,
  InMemoryBlobStore,
} from "../../../src/vendor/agent-kv/index.js";

const ASSISTANT_DEFAULTS = {
  api: "cursor-agent",
  provider: "cursor-agent",
  model: "grok-code-fast-1",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop" as const,
};

function createParams(options?: {
  messages?: Message[];
  conversationState?: ConversationStateStructure;
  state?: ReturnType<typeof createStateStore>;
  expectedLastAssistantTimestamp?: number;
}) {
  const blobStore = new InMemoryBlobStore();
  const model = {
    id: "grok-code-fast-1",
    name: "Grok",
    provider: "cursor-agent",
    api: "cursor-agent",
  } as Model<"cursor-agent">;

  const context = {
    systemPrompt: "You are a helpful assistant.",
    messages: options?.messages ?? [
      { role: "user", content: "Remember BANANA42.", timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "OK" }],
        timestamp: 2,
        ...ASSISTANT_DEFAULTS,
      },
      { role: "user", content: "What code word?", timestamp: 3 },
    ],
  } satisfies Context;

  return {
    blobStore,
    params: {
      model,
      context,
      conversationId: "test",
      blobStore,
      conversationState: options?.conversationState,
      mcpToolDefinitions: [],
      ...(options?.state ? { state: options.state } : {}),
      ...(options?.expectedLastAssistantTimestamp !== undefined
        ? {
            expectedLastAssistantTimestamp:
              options.expectedLastAssistantTimestamp,
          }
        : {}),
    },
  };
}

async function seedValidCachedState(
  blobStore: InMemoryBlobStore,
): Promise<ConversationStateStructure> {
  const sysBytes = new TextEncoder().encode(
    JSON.stringify({ role: "system", content: "You are a helpful assistant." }),
  );
  const sysId = new Uint8Array(Array.from(getBlobId(sysBytes)));
  await blobStore.setBlob(null, sysId, sysBytes);

  const userBytes = new UserMessage({
    text: "Remember BANANA42.",
    messageId: "m1",
  }).toBinary();
  const userId = new Uint8Array(Array.from(getBlobId(userBytes)));
  await blobStore.setBlob(null, userId, userBytes);

  const turnBytes = new ConversationTurnStructure({
    turn: {
      case: "agentConversationTurn",
      value: new AgentConversationTurnStructure({
        userMessage: userId,
        steps: [],
      }),
    },
  }).toBinary();
  const turnId = new Uint8Array(Array.from(getBlobId(turnBytes)));
  await blobStore.setBlob(null, turnId, turnBytes);

  return new ConversationStateStructure({
    rootPromptMessagesJson: [sysId],
    turns: [turnId],
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

function getSentUserText(
  result: Awaited<ReturnType<typeof buildRunRequest>>,
): string {
  assert.equal(result.initialRequest.message.case, "runRequest");
  const action = result.initialRequest.message.value.action?.action;
  assert.equal(action?.case, "userMessageAction");
  return action.value.userMessage?.text ?? "";
}

test("preserves cached conversation state when blobs exist and branch matches", async () => {
  const { params, blobStore } = createParams({
    expectedLastAssistantTimestamp: 2,
  });
  const cached = await seedValidCachedState(blobStore);
  params.conversationState = cached;

  const result = await buildRunRequest(params);
  assert.equal(result.conversationState, cached);
  assert.equal(getSentUserText(result), "What code word?");
});

test("reconstructs prior history into cold request when cached blobs are missing (fork scenario)", async () => {
  const sourceStore = new InMemoryBlobStore();
  const cached = await seedValidCachedState(sourceStore);

  // Forked session has an empty blob store even though snapshot carried cached state.
  const { params } = createParams({
    conversationState: cached,
    expectedLastAssistantTimestamp: 2,
  });

  const result = await buildRunRequest(params);
  assert.notEqual(result.conversationState, cached);
  assert.equal(result.conversationState.rootPromptMessagesJson.length, 1);
  assert.equal(result.conversationState.turns.length, 0);

  const text = getSentUserText(result);
  assert.ok(text.includes("<prior_conversation_history>"));
  assert.ok(text.includes("Remember BANANA42."));
  assert.ok(text.includes("OK"));
  assert.ok(text.includes("What code word?"));
});

test("reconstructs prior history when branch diverged or non-cursor provider ran", async () => {
  const { params, blobStore } = createParams({
    messages: [
      { role: "user", content: "Turn 1", timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "Anthropic reply" }],
        timestamp: 2,
        ...ASSISTANT_DEFAULTS,
        provider: "anthropic",
      },
      { role: "user", content: "Turn 2", timestamp: 3 },
    ],
    expectedLastAssistantTimestamp: 2,
  });
  const cached = await seedValidCachedState(blobStore);
  params.conversationState = cached;

  assert.equal(
    await canReuseConversationState(
      cached,
      blobStore,
      params.context.messages,
      true,
      2,
    ),
    false,
  );

  const result = await buildRunRequest(params);
  assert.notEqual(result.conversationState, cached);
  assert.ok(getSentUserText(result).includes("Anthropic reply"));
});

test("reconstruction includes tool calls and stored exec-type labels", async () => {
  const state = createStateStore(() => {});
  state.rememberAssistantContent({
    timestamp: 2,
    blocks: [
      { type: "thinking", thinking: "Let me check." },
      { type: "text", text: "Checking..." },
      {
        type: "toolCall",
        id: "tc-1",
        name: "read",
        arguments: { path: "a.ts" },
      },
    ],
  });
  state.rememberToolCallMeta({
    toolCallId: "tc-1",
    cursorExecType: "read",
    piToolName: "read",
    piToolArgs: { path: "a.ts" },
    assistantTimestamp: 2,
  });

  const { params } = createParams({
    messages: [
      { role: "user", content: "Read a.ts", timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "Checking..." }],
        timestamp: 2,
        ...ASSISTANT_DEFAULTS,
      },
      {
        role: "toolResult",
        toolCallId: "tc-1",
        toolName: "read",
        content: [{ type: "text", text: "const x = 1;" }],
        isError: false,
        timestamp: 3,
      },
      { role: "user", content: "What is in a.ts?", timestamp: 4 },
    ],
    state,
  });

  const result = await buildRunRequest(params);
  const text = getSentUserText(result);
  assert.ok(text.includes('[Tool: read {"path":"a.ts"}]'));
  assert.ok(text.includes("[read result]"));
  assert.ok(text.includes("const x = 1;"));
});

test("sanitizes TypeBox schemas with symbols and undefined values when building MCP tools", () => {
  const kindSym = Symbol("TypeBox.Kind");
  const defs = buildMcpToolDefinitions([
    {
      name: "codemode",
      description: "Run JS",
      parameters: {
        [kindSym]: "Object",
        type: "object",
        properties: {
          code: { type: "string", description: undefined },
        },
        required: ["code"],
      },
    } as unknown as NonNullable<Context["tools"]>[number],
  ]);

  assert.equal(defs.length, 1);
  assert.equal(defs[0]?.toolName, "codemode");
  assert.ok((defs[0]?.inputSchema.length ?? 0) > 0);
});
