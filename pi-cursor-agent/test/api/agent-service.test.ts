import assert from "node:assert/strict";
import * as net from "node:net";
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
  assert.equal(returnSpy.called, true);
});

test("AgentService constructor installs socket and session guards against uncaughtException", async () => {
  const service = new AgentService("https://127.0.0.1:54321", {
    accessToken: "test-token",
    clientType: "cli",
    clientVersion: "0.4.4",
  });

  assert.ok(service);
  assert.ok(service.rpcClient);
});

test("AgentService handles socket reset gracefully without uncaughtException", async () => {
  const server = net.createServer((sock) => {
    setTimeout(() => {
      sock.destroy();
    }, 5);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  let uncaughtError: unknown = null;
  const onUncaught = (err: unknown) => {
    uncaughtError = err;
  };
  process.on("uncaughtException", onUncaught);

  try {
    const service = new AgentService(`http://127.0.0.1:${port}`, {
      accessToken: "test-token",
      clientType: "cli",
      clientVersion: "0.4.4",
    });

    const stream = service.rpcClient.run(
      (async function* () {
        yield {} as AgentClientMessage;
      })(),
    );

    await assert.rejects(async () => {
      for await (const _ of stream) {
        // Should not receive messages
      }
    });
  } finally {
    process.off("uncaughtException", onUncaught);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  assert.equal(uncaughtError, null);
});
