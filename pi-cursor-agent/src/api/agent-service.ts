import {
  createClient,
  type Client,
  type Interceptor,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import {
  AgentClientMessage,
  type AgentServerMessage,
} from "../__generated__/agent/v1/agent_pb";
import { AgentService as AgentServiceDef } from "../__generated__/agent/v1/agent_service_connect";
import type { AgentRpcClient } from "../vendor/agent-client";

interface AgentServiceOptions {
  accessToken: string;
  clientType: string;
  clientVersion: string;
}

class AgentService {
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

  get rpcClient(): AgentRpcClient {
    const client = this.client;
    return {
      run(
        input: AsyncIterable<AgentClientMessage>,
        options?: { signal?: AbortSignal; headers?: Record<string, string> },
      ): AsyncIterable<AgentServerMessage> {
        return client.run(input, options);
      },
    };
  }
}

export default AgentService;
