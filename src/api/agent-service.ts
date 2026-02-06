import {
  createClient,
  type Client,
  type Interceptor,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { createWritableIterable } from "@connectrpc/connect/protocol";
import {
  AgentClientMessage,
  AgentServerMessage,
  ClientHeartbeat,
} from "../__generated__/agent/v1/agent_pb";
import { AgentService as AgentServiceDef } from "../__generated__/agent/v1/agent_service_connect";
import { heartbeat } from "../lib/heartbeat";

export interface AgentServiceOptions {
  accessToken: string;
  clientType: string;
  clientVersion: string;
}

export interface RunOptions {
  conversationState: Uint8Array;
  action: Uint8Array;
  modelDetails: Uint8Array;
  conversationId: string;
  signal?: AbortSignal | undefined;
  onMessage: (msg: AgentServerMessage) => void;
  sendMessage: () => AsyncIterable<AgentClientMessage>;
}

class AgentService {
  private static readonly HEARTBEAT_INTERVAL_MS = 5000;
  private readonly client: Client<typeof AgentServiceDef>;

  constructor(baseUrl: string, options: AgentServiceOptions) {
    const authInterceptor: Interceptor = (next) => async (req) => {
      req.header.set("authorization", `Bearer ${options.accessToken}`);
      req.header.set("x-cursor-client-type", options.clientType);
      req.header.set("x-cursor-client-version", options.clientVersion);
      req.header.set("x-ghost-mode", "true");
      req.header.set("x-request-id", crypto.randomUUID());
      return next(req);
    };

    const transport = createConnectTransport({
      baseUrl,
      httpVersion: "2",
      interceptors: [authInterceptor],
    });

    this.client = createClient(AgentServiceDef, transport);
  }

  public run(initialRequest: AgentClientMessage, signal?: AbortSignal) {
    const channel = createWritableIterable<AgentClientMessage>();
    void channel.write(initialRequest);

    const clear = heartbeat(() => {
      const message = new AgentClientMessage({
        message: { case: "clientHeartbeat", value: new ClientHeartbeat({}) },
      });
      return channel.write(message);
    }, AgentService.HEARTBEAT_INTERVAL_MS);

    const close = () => {
      clear();
      channel.close();
    };

    if (signal) {
      signal.addEventListener("abort", close, { once: true });
    }

    const response = this.client.run(channel, signal ? { signal } : {});
    const messages = (async function* () {
      try {
        yield* response;
      } finally {
        close();
      }
    })();

    const send = (msg: AgentClientMessage) => void channel.write(msg);
    return { messages, send, close };
  }
}

export default AgentService;
