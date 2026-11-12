import {
  type Client,
  createClient,
  type Interceptor,
} from "@connectrpc/connect";
import {
  createConnectTransport,
  Http2SessionManager,
} from "@connectrpc/connect-node";
import type {
  AgentClientMessage,
  AgentServerMessage,
} from "../__generated__/agent/v1/agent_pb";
import { AgentService as AgentServiceDef } from "../__generated__/agent/v1/agent_service_connect";
import type { AgentRpcClient } from "../vendor/agent-client";

interface AgentServiceOptions {
  accessToken: string;
  clientType: string;
  clientVersion: string;
}

function getAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }

  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

export function wrapAbortSafeStream(
  stream: AsyncIterable<AgentServerMessage>,
  signal: AbortSignal,
  onAbort: () => void = () => {},
): AsyncIterable<AgentServerMessage> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = stream[Symbol.asyncIterator]();
      let done = false;

      const closeIterator = async () => {
        if (done) {
          return { done: true, value: undefined as never };
        }

        done = true;
        return (
          (await iterator.return?.()) ?? {
            done: true,
            value: undefined as never,
          }
        );
      };

      return {
        async next() {
          if (done) {
            return { done: true, value: undefined as never };
          }

          let cleanup = () => {};
          try {
            const aborted = new Promise<never>((_, reject) => {
              const abort = () => {
                try {
                  onAbort();
                } finally {
                  reject(getAbortError(signal.reason));
                }
              };

              if (signal.aborted) {
                abort();
                return;
              }

              signal.addEventListener("abort", abort, { once: true });
              cleanup = () => {
                signal.removeEventListener("abort", abort);
              };
            });

            // Do not start a transport read for an already cancelled request.
            if (signal.aborted) return await aborted;
            const result = await Promise.race([iterator.next(), aborted]);
            if (result.done) {
              done = true;
            }
            return result;
          } catch (error) {
            // Async-generator return() may queue behind a stalled next(). Never
            // let it hide the original error or hold the cancellation hostage.
            void closeIterator().catch(() => {});
            throw error;
          } finally {
            cleanup();
          }
        },
        async return() {
          return closeIterator();
        },
        async throw(error) {
          done = true;
          if (iterator.throw) {
            return iterator.throw(error);
          }
          throw error;
        },
      };
    },
  };
}

class AgentService {
  private readonly client: Client<typeof AgentServiceDef>;
  private readonly sessionManager: Http2SessionManager;

  constructor(baseUrl: string, options: AgentServiceOptions) {
    const authInterceptor: Interceptor = (next) => async (req) => {
      req.header.set("authorization", `Bearer ${options.accessToken}`);
      req.header.set("x-cursor-client-type", options.clientType);
      req.header.set("x-cursor-client-version", options.clientVersion);
      req.header.set("x-ghost-mode", "true");
      req.header.set("x-request-id", crypto.randomUUID());
      return next(req);
    };

    this.sessionManager = new Http2SessionManager(baseUrl);
    const transport = createConnectTransport({
      baseUrl,
      sessionManager: this.sessionManager,
      httpVersion: "2",
      interceptors: [authInterceptor],
    });

    this.client = createClient(AgentServiceDef, transport);
  }

  close(): void {
    this.sessionManager.abort();
  }

  get rpcClient(): AgentRpcClient {
    const client = this.client;
    const close = () => this.close();

    return {
      run(
        input: AsyncIterable<AgentClientMessage>,
        options?: { signal?: AbortSignal; headers?: Record<string, string> },
      ): AsyncIterable<AgentServerMessage> {
        const response = client.run(input, {
          ...(options?.headers ? { headers: options.headers } : {}),
        });

        if (!options?.signal) {
          return response;
        }

        return wrapAbortSafeStream(response, options.signal, close);
      },
    };
  }
}

export default AgentService;
