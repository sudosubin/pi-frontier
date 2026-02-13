import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type {
  Api,
  OAuthCredentials,
  OAuthLoginCallbacks,
} from "@mariozechner/pi-ai";
import AiService from "./api/ai-service";
import Auth from "./api/auth";
import AuthManager from "./lib/auth";
import { restoreAgentStoreFromBranch } from "./pi/agent-store";
import { streamCursorAgent } from "./stream";
import {
  CURSOR_API_URL,
  CURSOR_CLIENT_VERSION,
  CURSOR_WEBSITE_URL,
} from "./lib/env";
import { getCachedPiModels, updateCachedPiModels } from "./pi/model";

const auth = new AuthManager(new Auth(CURSOR_API_URL), CURSOR_WEBSITE_URL);

const login = async (
  callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> => {
  const credentials = await auth.login(callbacks);
  const ai = new AiService(CURSOR_API_URL, {
    accessToken: credentials.access,
    clientVersion: CURSOR_CLIENT_VERSION,
    clientType: "cli",
  });
  await updateCachedPiModels(ai);
  return credentials;
};

const refreshToken = async (
  credentials: OAuthCredentials,
): Promise<OAuthCredentials> => {
  const refreshed = await auth.refresh(credentials);
  const ai = new AiService(CURSOR_API_URL, {
    accessToken: credentials.access,
    clientVersion: CURSOR_CLIENT_VERSION,
    clientType: "cli",
  });
  await updateCachedPiModels(ai);
  return refreshed;
};

export default (pi: ExtensionAPI) => {
  let lastCtx: ExtensionContext | null = null;
  const getCtx = () => lastCtx;

  const refreshBranchState = async (ctx: ExtensionContext) => {
    lastCtx = ctx;
    try {
      const sessionId = ctx.sessionManager.getSessionId();
      await restoreAgentStoreFromBranch(
        sessionId,
        ctx.sessionManager.getBranch(),
      );
    } catch {
      // ignore
    }
  };

  pi.on("session_start", async (_, ctx) => {
    await refreshBranchState(ctx);
  });

  pi.on("session_switch", async (_, ctx) => {
    await refreshBranchState(ctx);
  });

  pi.on("session_tree", async (_, ctx) => {
    await refreshBranchState(ctx);
  });

  pi.on("before_agent_start", async (_, ctx) => {
    lastCtx = ctx;
  });

  pi.on("agent_start", async (_, ctx) => {
    lastCtx = ctx;
  });

  pi.registerProvider("cursor", {
    baseUrl: CURSOR_API_URL,
    apiKey: "CURSOR_ACCESS_TOKEN",
    api: "cursor-agent" as unknown as Api,
    streamSimple: (model, context, options) =>
      streamCursorAgent(pi, getCtx, model, context, options),
    models: getCachedPiModels(),
    oauth: {
      name: "Cursor",
      login,
      refreshToken,
      getApiKey: (cred) => cred.access,
    },
  });
};
