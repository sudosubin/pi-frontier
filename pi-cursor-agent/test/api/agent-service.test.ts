import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "@connectrpc/connect";
import type {
  AgentClientMessage,
  AgentServerMessage,
} from "../../src/__generated__/agent/v1/agent_pb.js";
import type { AgentService as AgentServiceDef } from "../../src/__generated__/agent/v1/agent_service_connect.js";
import AgentService, {
  wrapAbortSafeStream,
} from "../../src/api/agent-service.js";

function createNeverEndingStream(returnSpy?: {
  called: boolean;
}): AsyncIterable<AgentServerMessage> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return new Promise<IteratorResult<AgentServerMessage>>(() => {});
        },
        async return() {
          if (returnSpy) {
            returnSpy.called = true;
          }
          return { done: true, value: undefined as never };
        },
      };
    },
  };
}

test("wrapAbortSafeStream aborts by closing the underlying iterator", async () => {
  const controller = new AbortController();
  const returnSpy = { called: false };
  const stream = wrapAbortSafeStream(
    createNeverEndingStream(returnSpy),
    controller.signal,
  );

  const iterator = stream[Symbol.asyncIterator]();
  const nextPromise = iterator.next();
  controller.abort();

  await assert.rejects(nextPromise, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "AbortError");
    return true;
  });
  assert.equal(returnSpy.called, true);
});

test("rpcClient strips transport signal and still aborts the response stream", async () => {
  const controller = new AbortController();
  const returnSpy = { called: false };
  let seenOptions:
    | { signal?: AbortSignal; headers?: Record<string, string> }
    | undefined;

  const client = {
    run(
      _input: AsyncIterable<AgentClientMessage>,
      options?: { signal?: AbortSignal; headers?: Record<string, string> },
    ): AsyncIterable<AgentServerMessage> {
      seenOptions = options;
      return createNeverEndingStream(returnSpy);
    },
  } as Client<typeof AgentServiceDef>;

  const service = Object.create(AgentService.prototype) as AgentService;
  Reflect.set(service as object, "client", client);
  let closed = 0;
  Reflect.set(service as object, "sessionManager", {
    abort: () => {
      closed++;
    },
  });

  const stream = service.rpcClient.run(
    {
      async *[Symbol.asyncIterator]() {},
    },
    { signal: controller.signal, headers: { "x-test": "1" } },
  );

  const iterator = stream[Symbol.asyncIterator]();
  const nextPromise = iterator.next();
  controller.abort();

  await assert.rejects(nextPromise, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "AbortError");
    return true;
  });

  assert.deepEqual(seenOptions, { headers: { "x-test": "1" } });
  assert.equal(closed, 1);
  assert.equal(returnSpy.called, true);
});

test(
  "abort settles even when iterator return stalls or rejects",
  { timeout: 1000 },
  async () => {
    for (const stalled of [true, false]) {
      const controller = new AbortController();
      let closed = 0;
      const wrapped = wrapAbortSafeStream(
        {
          [Symbol.asyncIterator]() {
            return {
              next: () =>
                new Promise<IteratorResult<AgentServerMessage>>(() => {}),
              return: () =>
                stalled
                  ? new Promise<IteratorResult<AgentServerMessage>>(() => {})
                  : Promise.reject(new Error("cleanup failed")),
            };
          },
        },
        controller.signal,
        () => {
          closed++;
        },
      );
      const result = wrapped[Symbol.asyncIterator]().next();
      controller.abort(new Error("cancelled"));
      await assert.rejects(result, /cancelled/);
      assert.equal(closed, 1);
    }
  },
);

test("pre-aborted streams never start an underlying read", async () => {
  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  const stream = wrapAbortSafeStream(
    {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            reads++;
            return { done: true, value: undefined };
          },
        };
      },
    },
    controller.signal,
  );
  await assert.rejects(stream[Symbol.asyncIterator]().next(), /abort/i);
  assert.equal(reads, 0);
});
