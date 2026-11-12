import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, afterEach, mock } from "node:test";
import type { Api, Context, Model } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@mariozechner/pi-coding-agent";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-stream-test-"));
process.env["PI_CODING_AGENT_DIR"] = directory;
const { createLazyCursorRuntime } = await import(
  "../../src/provider/lazy-runtime.js"
);
const { createStateStore } = await import("../../src/provider/state.js");
const { AgentConnectClient } = await import(
  "../../src/vendor/agent-client/index.js"
);
const { getLiveSession, LiveEventChannel } = await import(
  "../../src/provider/agent-stream-hook.js"
);
const { requestToolExecution, resolveToolResult } = await import(
  "../../src/bridge/cursor-to-pi/tool-bridge.js"
);
const { ConversationStateStructure } = await import(
  "../../src/__generated__/agent/v1/agent_pb.js"
);
const { ensureAgentStore, persistAgentStore, restoreAgentStoreFromBranch } =
  await import("../../src/provider/agent-store.js");
const { terminateSession } = await import(
  "../../src/provider/session-lifecycle.js"
);
const { hasAgentStore } = await import("../../src/lib/agent-store/index.js");
afterEach(() => mock.restoreAll());
after(() => fs.rmSync(directory, { recursive: true, force: true }));
const model = {
  id: "composer-2",
  api: "cursor-agent",
  provider: "cursor-agent",
} as Model<Api>;
const context: Context = {
  messages: [{ role: "user", content: "hello", timestamp: 1 }],
};

function setup() {
  const entries: { session: string; type: string; data: unknown }[] = [];
  let id: string = crypto.randomUUID();
  let branch: SessionEntry[] = [];
  const ctx = {
    cwd: directory,
    sessionManager: { getSessionId: () => id, getBranch: () => branch },
  } as unknown as ExtensionContext;
  const pi = {
    getActiveTools: () => ["read", "write"],
    appendEntry(type: string, data: unknown) {
      entries.push({ session: id, type, data });
    },
  } as unknown as ExtensionAPI;
  const state = createStateStore((type, data) => pi.appendEntry(type, data));
  const runtime = createLazyCursorRuntime(pi, () => ctx, state);
  return {
    runtime,
    ctx,
    entries,
    id: () => id,
    select(next: string, nextBranch: SessionEntry[] = []) {
      id = next;
      branch = nextBranch;
    },
    request: (signal?: AbortSignal) =>
      runtime.stream(model, context, {
        apiKey: "fake-token-never-sent",
        sessionId: id,
        ...(signal ? { signal } : {}),
      }),
  };
}

test(
  "real stream reports server failure as error and the next request recovers",
  { timeout: 5000 },
  async () => {
    const s = setup();
    await s.runtime.refreshBranchState(s.ctx);
    let runs = 0;
    mock.method(
      AgentConnectClient.prototype,
      "run",
      async (
        _request: Parameters<InstanceType<typeof AgentConnectClient>["run"]>[0],
        options: Parameters<InstanceType<typeof AgentConnectClient>["run"]>[1],
      ) => {
        if (++runs === 1) throw new Error("server rejected credentials");
        await options.interactionListener.sendUpdate(null, {
          type: "text-delta",
          text: "recovered",
        });
      },
    );
    const failed = await s.request().result();
    assert.equal(failed.stopReason, "error");
    assert.match(failed.errorMessage ?? "", /server rejected/);
    assert.equal(getLiveSession(s.id()), undefined);
    const succeeded = await s.request().result();
    assert.equal(succeeded.stopReason, "stop");
    assert.deepEqual(succeeded.content, [{ type: "text", text: "recovered" }]);
    await s.runtime.shutdown();
  },
);

test(
  "real tool bridge continues one run and honours the continuation's abort signal",
  { timeout: 5000 },
  async () => {
    const s = setup();
    await s.runtime.refreshBranchState(s.ctx);
    let runs = 0;
    let toolResultSeen = false;
    mock.method(
      AgentConnectClient.prototype,
      "run",
      async (
        _request: Parameters<InstanceType<typeof AgentConnectClient>["run"]>[0],
        options: Parameters<InstanceType<typeof AgentConnectClient>["run"]>[1],
      ) => {
        runs++;
        await new Promise(setImmediate);
        const live = getLiveSession(s.id());
        assert.ok(live);
        const result = await requestToolExecution(live.channel, {
          toolCallId: "actual-bridge-call",
          cursorExecType: "read",
          piToolName: "read",
          piToolArgs: { path: "fixture.txt" },
        });
        toolResultSeen =
          result.content[0]?.type === "text" &&
          result.content[0].text === "fixture";
        await options.interactionListener.sendUpdate(null, {
          type: "text-delta",
          text: "continued",
        });
        await new Promise<void>((resolve) =>
          options.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
      },
    );
    const first = await s.request().result();
    assert.equal(first.stopReason, "toolUse");
    const live = getLiveSession(s.id());
    assert.ok(live);
    assert.equal(
      resolveToolResult({
        role: "toolResult",
        toolCallId: "actual-bridge-call",
        toolName: "read",
        content: [{ type: "text", text: "fixture" }],
        isError: false,
        timestamp: 2,
      }),
      true,
    );
    const controller = new AbortController();
    const second = s.request(controller.signal);
    for await (const event of second) {
      if (event.type === "text_delta") controller.abort();
    }
    assert.equal((await second.result()).stopReason, "aborted");
    assert.equal(toolResultSeen, true);
    assert.equal(runs, 1);
    assert.equal(getLiveSession(s.id()), undefined);
    await s.runtime.shutdown();
  },
);

test(
  "session switch rejects a pending real bridge call without writing into the new session",
  { timeout: 5000 },
  async () => {
    const s = setup();
    await s.runtime.refreshBranchState(s.ctx);
    const oldId = s.id();
    let rejected = false;
    mock.method(AgentConnectClient.prototype, "run", async () => {
      await new Promise(setImmediate);
      const live = getLiveSession(oldId);
      assert.ok(live);
      try {
        await requestToolExecution(live.channel, {
          toolCallId: "pending-switch",
          cursorExecType: "read",
          piToolName: "read",
          piToolArgs: {},
        });
      } catch {
        rejected = true;
        throw new Error("session ended");
      }
    });
    assert.equal((await s.request().result()).stopReason, "toolUse");
    const before = s.entries.length;
    s.select("new-session");
    await s.runtime.refreshBranchState(s.ctx);
    assert.equal(rejected, true);
    assert.equal(s.entries.length, before);
    assert.equal(getLiveSession(oldId), undefined);
    assert.equal(hasAgentStore(oldId), false);
    await s.runtime.shutdown();
  },
);

test("branch restore uses real root blobs, rejects missing blobs, retries and clears stale state", async () => {
  const s = setup();
  const store = await ensureAgentStore(s.id());
  await store.handleCheckpoint(
    null,
    new ConversationStateStructure({ pendingToolCalls: ["saved-call"] }),
  );
  const snapshot = await persistAgentStore(s.id());
  assert.ok(snapshot?.latestRootBlobId);
  const entry = (data: unknown): SessionEntry =>
    ({
      type: "custom",
      customType: "pi-cursor-agent:state",
      data,
    }) as SessionEntry;
  s.select(s.id(), [entry({ ...snapshot, latestRootBlobId: "ff".repeat(32) })]);
  await s.runtime.refreshBranchState(s.ctx);
  const failed = await s.runtime
    .stream(model, context, { sessionId: s.id() })
    .result();
  assert.equal(failed.stopReason, "error");
  assert.match(failed.errorMessage ?? "", /checkpoint blob is missing/);
  s.select(s.id(), [entry(snapshot)]);
  await s.runtime.refreshBranchState(s.ctx);
  // Missing key now, rather than restoration failure: the lazy retry succeeded.
  const retried = await s.runtime
    .stream(model, context, { sessionId: s.id() })
    .result();
  assert.match(retried.errorMessage ?? "", /Cursor API key/);
  await restoreAgentStoreFromBranch(s.id(), [entry(snapshot)]);
  assert.deepEqual(
    (await ensureAgentStore(s.id())).getConversationStateStructure()
      .pendingToolCalls,
    ["saved-call"],
  );
  await restoreAgentStoreFromBranch(s.id(), []);
  assert.deepEqual(
    (await ensureAgentStore(s.id())).getConversationStateStructure()
      .pendingToolCalls,
    [],
  );
  assert.notEqual((await ensureAgentStore(s.id())).getId(), snapshot.agentId);
  await s.runtime.shutdown();
});

test("channel failure wakes readers and discards queued tools and late events", async () => {
  const channel = new LiveEventChannel("cancel");
  const pending = channel.next();
  channel.fail(new Error("cancelled"));
  await assert.rejects(pending, /cancelled/);
  channel.push({ kind: "cursor-done" });
  await assert.rejects(channel.next(), /cancelled/);
});

test(
  "termination detaches a stalled run before late cleanup",
  { timeout: 4000 },
  async () => {
    const s = setup();
    await s.runtime.refreshBranchState(s.ctx);
    mock.method(
      AgentConnectClient.prototype,
      "run",
      async () => new Promise<void>(() => {}),
    );
    const stream = s.request();
    for await (const event of stream) {
      if (event.type === "start") {
        await terminateSession(s.id(), "Session ended");
      }
    }
    assert.equal((await stream.result()).stopReason, "error");
    assert.equal(getLiveSession(s.id()), undefined);
    await s.runtime.shutdown();
  },
);

test(
  "checkpoint persistence failures are awaited and reported by the real stream",
  { timeout: 5000 },
  async () => {
    const s = setup();
    await s.runtime.refreshBranchState(s.ctx);
    // Load/restore the lazy runtime before replacing the real store's disk operation.
    await s.runtime.stream(model, context, { sessionId: s.id() }).result();
    const store = await ensureAgentStore(s.id());
    mock.method(store, "handleCheckpoint", async () => {
      await new Promise(setImmediate);
      throw new Error("checkpoint write failed");
    });
    mock.method(
      AgentConnectClient.prototype,
      "run",
      async (
        _request: Parameters<InstanceType<typeof AgentConnectClient>["run"]>[0],
        options: Parameters<InstanceType<typeof AgentConnectClient>["run"]>[1],
      ) => {
        await options.checkpointHandler.handleCheckpoint(
          null,
          new ConversationStateStructure(),
        );
      },
    );
    const result = await s.request().result();
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage ?? "", /checkpoint write failed/);
    await s.runtime.shutdown();
  },
);

test(
  "same-session tree navigation terminates the old run before restoring the branch",
  { timeout: 5000 },
  async () => {
    const s = setup();
    await s.runtime.refreshBranchState(s.ctx);
    mock.method(AgentConnectClient.prototype, "run", async () => {
      await new Promise(setImmediate);
      const live = getLiveSession(s.id());
      assert.ok(live);
      await requestToolExecution(live.channel, {
        toolCallId: "old-branch",
        cursorExecType: "read",
        piToolName: "read",
        piToolArgs: {},
      });
    });
    assert.equal((await s.request().result()).stopReason, "toolUse");
    const before = s.entries.length;
    // Same session id, but a branch before any Cursor checkpoint.
    await s.runtime.refreshBranchState(s.ctx);
    assert.equal(getLiveSession(s.id()), undefined);
    assert.equal(s.entries.length, before);
    assert.deepEqual(
      (await ensureAgentStore(s.id())).getConversationStateStructure()
        .pendingToolCalls,
      [],
    );
    assert.equal(
      resolveToolResult({
        role: "toolResult",
        toolCallId: "old-branch",
        toolName: "read",
        content: [],
        isError: false,
        timestamp: 3,
      }),
      false,
    );
    await s.runtime.shutdown();
  },
);
