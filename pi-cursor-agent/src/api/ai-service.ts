import {
  type Client,
  createClient,
  type Interceptor,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { AiService as AiServiceDef } from "../__generated__/aiserver/v1/aiserver_service_connect";

interface AgentServiceOptions {
  accessToken: string;
  clientType: string;
  clientVersion: string;
}

class AiService {
  private readonly client: Client<typeof AiServiceDef>;

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
      httpVersion: "1.1",
      interceptors: [authInterceptor],
    });

    this.client = createClient(AiServiceDef, transport);
  }

  public async getUsableModels() {
    return this.client.getUsableModels({});
  }
}

export default AiService;
