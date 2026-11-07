import assert from "node:assert/strict";
import test from "node:test";
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  createAssistantMessageEventStream,
  type Model,
} from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  type CursorRuntime,
  createLazyCursorRuntime,
} from "../../src/provider/lazy-runtime.js";
import { createStateStore } from "../../src/provider/state.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const model = {
  id: "composer-2",
  api: "cursor-agent",
  provider: "cursor-agent",
} as Model<Api>;
const message: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "hello" }],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 1,
};

function ctx(id: string): ExtensionContext {
  return {
    sessionManager: { getSessionId: () => id, getBranch: () => [] },
  } as unknown as ExtensionContext;
}

function setup(loader?: () => Promise<CursorRuntime>) {
  let loads = 0;
  const restored: string[] = [];
  let streams = 0;
  let shutdowns = 0;
  const runtime: CursorRuntime = {
    async refreshBranchState(context) {
      restored.push(context.sessionManager.getSessionId());
    },
    stream() {
      streams++;
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: "stop", message });
      stream.end();
      return stream;
    },
    async shutdown() {
      shutdowns++;
    },
  };
  const lazy = createLazyCursorRuntime(
    {} as ExtensionAPI,
    () => null,
    createStateStore(() => {}),
    async () => {
      loads++;
      return loader ? loader() : runtime;
    },
  );
  return {
    lazy,
    runtime,
    restored,
    counts: () => ({ loads, streams, shutdowns }),
    request: (signal?: AbortSignal) =>
      lazy.stream(model, { messages: [] }, signal ? { signal } : undefined),
  };
}

test("session and tree events, tool-free startup, and shutdown never load the runtime", async () => {
  const s = setup();
  await s.lazy.refreshBranchState(ctx("a"));
  await s.lazy.refreshBranchState(ctx("b"));
  await s.lazy.shutdown();
  assert.deepEqual(s.counts(), { loads: 0, streams: 0, shutdowns: 0 });
});

test("first request returns a stream synchronously and forwards events and result unchanged", async () => {
  const s = setup();
  await s.lazy.refreshBranchState(ctx("a"));
  const stream = s.request();
  assert.equal(typeof stream.result, "function");
  assert.equal("then" in stream, false);
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "done"],
  );
  assert.equal(await stream.result(), message);
  assert.deepEqual(s.restored, ["a"]);
  await s.request().result();
  assert.deepEqual(s.counts(), { loads: 1, streams: 2, shutdowns: 0 });
  assert.deepEqual(s.restored, ["a"]);
});

test("concurrent first requests share both loading and initial branch restoration", async () => {
  const ready = deferred<CursorRuntime>();
  const s = setup(() => ready.promise);
  await s.lazy.refreshBranchState(ctx("a"));
  const a = s.request();
  const b = s.request();
  ready.resolve(s.runtime);
  await Promise.all([a.result(), b.result()]);
  assert.deepEqual(s.counts(), { loads: 1, streams: 2, shutdowns: 0 });
  assert.deepEqual(s.restored, ["a"]);
});

test("only the latest pre-load branch is restored; loaded runtime handles later branch/session changes", async () => {
  const s = setup();
  await s.lazy.refreshBranchState(ctx("abandoned"));
  await s.lazy.refreshBranchState(ctx("fork"));
  await s.request().result();
  await s.lazy.refreshBranchState(ctx("tree"));
  await s.lazy.refreshBranchState(ctx("resume"));
  await s.request().result();
  assert.deepEqual(s.restored, ["fork", "tree", "resume"]);
  assert.equal(s.counts().loads, 1);
});

test("a failed import emits a terminal error and a later request can retry", async () => {
  let attempts = 0;
  const s = setup(async () => {
    if (++attempts === 1) throw new Error("import failed");
    return s.runtime;
  });
  const stream = s.request();
  const events = [];
  for await (const event of stream) events.push(event);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "error");
  assert.equal((await stream.result()).errorMessage, "import failed");
  assert.equal((await s.request().result()).stopReason, "stop");
  assert.equal(s.counts().loads, 2);
});

test("lifecycle refresh tolerates an in-flight import failure while requests report it and can retry", async () => {
  const ready = deferred<CursorRuntime>();
  let attempts = 0;
  const s = setup(async () => {
    if (++attempts === 1) return ready.promise;
    return s.runtime;
  });
  await s.lazy.refreshBranchState(ctx("old"));
  const request = s.request();
  const refreshed = s.lazy.refreshBranchState(ctx("new"));
  const accepted = assert.doesNotReject(refreshed);
  ready.reject(new Error("import failed"));
  await accepted;
  assert.equal((await request.result()).errorMessage, "import failed");
  assert.equal(s.counts().streams, 0);
  assert.equal((await s.request().result()).stopReason, "stop");
  assert.deepEqual(s.restored, ["new"]);
  assert.equal(s.counts().loads, 2);
});

test("an already aborted first request does not trigger loading", async () => {
  const s = setup();
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const result = await s.request(controller.signal).result();
  assert.equal(result.stopReason, "aborted");
  assert.equal(s.counts().loads, 0);
});

test(
  "cancellation during loading settles promptly and never starts the cancelled request",
  { timeout: 1000 },
  async () => {
    const ready = deferred<CursorRuntime>();
    const s = setup(() => ready.promise);
    const controller = new AbortController();
    const stream = s.request(controller.signal);
    await Promise.resolve();
    controller.abort(new Error("cancelled during import"));
    const result = await stream.result();
    assert.equal(result.stopReason, "aborted");
    assert.equal(result.errorMessage, "cancelled during import");
    ready.resolve(s.runtime);
    await s.request().result();
    assert.deepEqual(s.counts(), { loads: 1, streams: 1, shutdowns: 0 });
  },
);

test("session changes during loading prevent an old request from running in the new session", async () => {
  const ready = deferred<CursorRuntime>();
  const s = setup(() => ready.promise);
  await s.lazy.refreshBranchState(ctx("old"));
  const old = s.request();
  const changed = s.lazy.refreshBranchState(ctx("new"));
  ready.resolve(s.runtime);
  await changed;
  assert.match((await old.result()).errorMessage ?? "", /session changed/);
  assert.equal(s.counts().streams, 0);
  await s.request().result();
  assert.deepEqual(s.restored, ["new"]);
});

test("shutdown during import prevents a late request and cleans up exactly once", async () => {
  const ready = deferred<CursorRuntime>();
  const s = setup(() => ready.promise);
  const stream = s.request();
  const shutdown = s.lazy.shutdown();
  ready.resolve(s.runtime);
  await shutdown;
  assert.equal((await stream.result()).stopReason, "error");
  await s.lazy.shutdown();
  assert.deepEqual(s.counts(), { loads: 1, streams: 0, shutdowns: 1 });
});

test("shutdown cleans up a previously loaded runtime and rejects future requests without reloading", async () => {
  const s = setup();
  await s.request().result();
  await s.lazy.shutdown();
  assert.equal((await s.request().result()).stopReason, "error");
  assert.deepEqual(s.counts(), { loads: 1, streams: 1, shutdowns: 1 });
});

test("failed restoration does not poison the refresh queue", async () => {
  const s = setup();
  const restore = s.runtime.refreshBranchState;
  let attempts = 0;
  s.runtime.refreshBranchState = async (context) => {
    if (++attempts === 1) throw new Error("restore failed");
    await restore(context);
  };
  await s.lazy.refreshBranchState(ctx("a"));
  assert.equal((await s.request().result()).errorMessage, "restore failed");
  assert.equal((await s.request().result()).stopReason, "stop");
  assert.deepEqual(s.restored, ["a"]);
});

test("lifecycle restore failures stay retryable and remain visible to requests", async () => {
  const s = setup();
  await s.lazy.refreshBranchState(ctx("old"));
  await s.request().result();
  const restore = s.runtime.refreshBranchState;
  let attempts = 0;
  let fail = true;
  s.runtime.refreshBranchState = async (context) => {
    attempts++;
    if (fail) throw new Error("restore failed");
    await restore(context);
  };
  await assert.doesNotReject(s.lazy.refreshBranchState(ctx("new")));
  assert.equal((await s.request().result()).errorMessage, "restore failed");
  assert.equal(s.counts().streams, 1);
  fail = false;
  assert.equal((await s.request().result()).stopReason, "stop");
  assert.equal(attempts, 3);
  assert.deepEqual(s.restored, ["old", "new"]);
  assert.deepEqual(s.counts(), { loads: 1, streams: 2, shutdowns: 0 });
});

test("tool-use boundaries and continuation results are forwarded without another restore", async () => {
  const s = setup();
  let turn = 0;
  s.runtime.stream = () => {
    const stream = createAssistantMessageEventStream();
    const reason = turn++ === 0 ? "toolUse" : "stop";
    stream.push({
      type: "done",
      reason,
      message: { ...message, stopReason: reason },
    });
    stream.end();
    return stream;
  };
  await s.lazy.refreshBranchState(ctx("a"));
  assert.equal((await s.request().result()).stopReason, "toolUse");
  assert.equal((await s.request().result()).stopReason, "stop");
  assert.deepEqual(s.restored, ["a"]);
});
