import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import type { Api, Model } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@mariozechner/pi-coding-agent";

const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "cursor-runtime-test-"),
);
process.env["PI_CODING_AGENT_DIR"] = directory;
const { ConversationStateStructure } = await import(
  "../../src/__generated__/agent/v1/agent_pb.js"
);
const { ensureAgentStore, hasAgentStore, retainOnlyAgentStore } = await import(
  "../../src/lib/agent-store/index.js"
);
const { createLazyCursorRuntime } = await import(
  "../../src/provider/lazy-runtime.js"
);
const { createCursorRuntime } = await import("../../src/provider/runtime.js");
const { createStateStore } = await import("../../src/provider/state.js");
const {
  getLiveSession,
  LiveEventChannel,
  retainOnlyLiveSession,
  setLiveSession,
} = await import("../../src/provider/agent-stream-hook.js");
const { requestToolExecution } = await import(
  "../../src/bridge/cursor-to-pi/tool-bridge.js"
);
const { PI_CURSOR_AGENT_CACHE_DIR } = await import("../../src/provider/env.js");
after(() => {
  retainOnlyAgentStore(null);
  retainOnlyLiveSession(null);
  fs.rmSync(directory, { recursive: true, force: true });
});

function context(id: string): ExtensionContext {
  const checkpoint = new ConversationStateStructure({
    pendingToolCalls: [`saved-${id}`],
  });
  return {
    sessionManager: {
      getSessionId: () => id,
      getBranch: () =>
        [
          {
            type: "custom",
            customType: "pi-cursor-agent:state",
            data: {
              version: 1,
              agentId: `agent-${id}`,
              latestRootBlobId: "",
              conversationState: Buffer.from(checkpoint.toBinary()).toString(
                "base64",
              ),
            },
          },
          {
            type: "custom",
            customType: "pi-cursor-agent:tool-call-meta",
            data: {
              toolCallId: `tool-${id}`,
              cursorExecType: "read",
              piToolName: "read",
              piToolArgs: { path: "README.md" },
              assistantTimestamp: 1000,
            },
          },
        ] as SessionEntry[],
    },
  } as unknown as ExtensionContext;
}

test("the real lazy runtime restores saved Cursor state and metadata on its first request", async () => {
  const state = createStateStore(() => {});
  const ctx = context("resume");
  const runtime = createLazyCursorRuntime({} as ExtensionAPI, () => ctx, state);
  await runtime.refreshBranchState(ctx);
  assert.equal(hasAgentStore("resume"), false);
  assert.equal(state.getToolCallMeta("tool-resume"), undefined);
  const result = await runtime
    .stream(
      {
        id: "composer-2",
        api: "cursor-agent",
        provider: "cursor-agent",
      } as Model<Api>,
      { messages: [] },
      { sessionId: "resume" },
    )
    .result();
  // Missing credentials stop before any network operation; error cleanup persists
  // the restored checkpoint, allowing its actual contents to be checked on disk.
  assert.equal(result.stopReason, "error");
  assert.match(result.errorMessage ?? "", /Cursor API key/);
  assert.equal(state.getToolCallMeta("tool-resume")?.piToolName, "read");
  const { store } = await ensureAgentStore(PI_CURSOR_AGENT_CACHE_DIR, "resume");
  assert.equal(store.getId(), "agent-resume");
  // Conversation structure is part of the session snapshot (not the disk metadata).
  await runtime.refreshBranchState(ctx);
  const restored = await ensureAgentStore(PI_CURSOR_AGENT_CACHE_DIR, "resume");
  assert.deepEqual(
    restored.store.getConversationStateStructure().pendingToolCalls,
    ["saved-resume"],
  );
  await runtime.shutdown();
  assert.equal(hasAgentStore("resume"), false);
});

test("the real runtime terminates a previous live session and restores the selected branch", async () => {
  const state = createStateStore(() => {});
  const runtime = createCursorRuntime({} as ExtensionAPI, () => null, state);
  await runtime.refreshBranchState(context("a"));
  let aborted = 0;
  let flushed = 0;
  let finish!: () => void;
  const run = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const channel = new LiveEventChannel("a");
  setLiveSession("a", {
    channel,
    cursorRunPromise: run,
    flushSessionState: async () => {
      flushed++;
    },
    abort: () => {
      aborted++;
      finish();
    },
    startTime: Date.now(),
  });
  const pending = requestToolExecution(channel, {
    toolCallId: "pending-a",
    cursorExecType: "read",
    piToolName: "read",
    piToolArgs: {},
  });
  const rejected = assert.rejects(pending, /Session ended/);
  await runtime.refreshBranchState(context("b"));
  await rejected;
  assert.equal(aborted, 1);
  assert.equal(flushed, 1);
  assert.equal(getLiveSession("a"), undefined);
  assert.equal(hasAgentStore("a"), false);
  assert.equal(state.getToolCallMeta("tool-a"), undefined);
  assert.equal(state.getToolCallMeta("tool-b")?.piToolName, "read");
  const { store } = await ensureAgentStore(PI_CURSOR_AGENT_CACHE_DIR, "b");
  assert.equal(store.getId(), "agent-b");
  assert.deepEqual(store.getConversationStateStructure().pendingToolCalls, [
    "saved-b",
  ]);
  await runtime.shutdown();
  assert.equal(hasAgentStore("b"), false);
});
