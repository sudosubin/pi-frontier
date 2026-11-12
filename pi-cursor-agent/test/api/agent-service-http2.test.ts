import assert from "node:assert/strict";
import { createServer, type ServerHttp2Session } from "node:http2";
import test from "node:test";
import { createWritableIterable } from "@connectrpc/connect/protocol";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  AgentClientMessage,
  AgentServerMessage,
} from "../../src/__generated__/agent/v1/agent_pb.js";
import { AgentService as AgentServiceDef } from "../../src/__generated__/agent/v1/agent_service_connect.js";
import AgentService from "../../src/api/agent-service.js";

// Real local HTTP/2 + Connect transport, no Cursor account or external network.
test(
  "HTTP/2 cancellation closes the owned connection and permits a new run",
  { timeout: 10000 },
  async (t) => {
    const connections = new Set<ServerHttp2Session>();
    let closed = 0;
    const server = createServer(
      connectNodeAdapter({
        routes(router) {
          router.service(AgentServiceDef, {
            async *run(input, ctx) {
              for await (const _ of input) {
                yield new AgentServerMessage();
                await new Promise<void>((resolve) => {
                  if (ctx.signal.aborted) resolve();
                  else
                    ctx.signal.addEventListener("abort", () => resolve(), {
                      once: true,
                    });
                });
                return;
              }
            },
          });
        },
      }),
    );
    server.on("session", (session) => {
      connections.add(session);
      session.on("close", () => {
        connections.delete(session);
        closed++;
      });
    });
    t.after(async () => {
      for (const session of connections) session.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        t.skip(
          "This sandbox forbids local listeners; run in CI or a local Node environment",
        );
        return;
      }
      throw error;
    }
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const service = new AgentService(`http://127.0.0.1:${address.port}`, {
      accessToken: "local-fixture-only",
      clientType: "cli",
      clientVersion: "test",
    });
    t.after(() => service.close());
    for (let attempt = 0; attempt < 2; attempt++) {
      const input = createWritableIterable<AgentClientMessage>();
      const controller = new AbortController();
      const iterator = service.rpcClient
        .run(input, { signal: controller.signal })
        [Symbol.asyncIterator]();
      const first = iterator.next();
      await input.write(new AgentClientMessage());
      assert.equal((await first).done, false);
      const pending = iterator.next();
      controller.abort();
      await assert.rejects(pending, /abort/i);
      input.close();
      const deadline = Date.now() + 1000;
      while (closed < attempt + 1 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(
        closed,
        attempt + 1,
        "Cancelled HTTP/2 connection was left open",
      );
    }
  },
);
