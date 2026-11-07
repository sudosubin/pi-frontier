import type {
  Api,
  OAuthCredentials,
  OAuthLoginCallbacks,
} from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import Auth from "./api/auth";
import { resolveToolResult } from "./bridge/cursor-to-pi/tool-bridge";
import AuthManager from "./lib/auth";
import {
  CURSOR_API_URL,
  CURSOR_CLIENT_VERSION,
  CURSOR_WEBSITE_URL,
} from "./lib/env";
import { createLazyCursorRuntime } from "./provider/lazy-runtime";
import {
  getCachedPiModels,
  updateCachedPiModelsIfStale,
} from "./provider/models";
import { createStateStore } from "./provider/state";

const auth = new AuthManager(new Auth(CURSOR_API_URL), CURSOR_WEBSITE_URL);

const createAiService = async (accessToken: string) => {
  const { default: AiService } = await import("./api/ai-service");
  return new AiService(CURSOR_API_URL, {
    accessToken,
    clientVersion: CURSOR_CLIENT_VERSION,
    clientType: "cli",
  });
};

const updateCachedModelsInBackground = (accessToken: string) => {
  void updateCachedPiModelsIfStale(() => createAiService(accessToken)).catch(
    () => {},
  ); // ignore
};

const updateCachedModelsFromContextInBackground = (ctx: ExtensionContext) => {
  void (async () => {
    const accessToken =
      await ctx.modelRegistry.getApiKeyForProvider("cursor-agent");
    if (!accessToken) {
      return;
    }

    await updateCachedPiModelsIfStale(() => createAiService(accessToken));
  })().catch(() => {}); // ignore
};

const login = async (
  callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> => {
  const credentials = await auth.login(callbacks);
  if (getCachedPiModels().length === 0) {
    // Pi refreshes its registry after login. Populate the first catalog before
    // returning so that refresh cannot race an empty cache.
    callbacks.onProgress?.("Loading Cursor models...");
    await updateCachedPiModelsIfStale(() =>
      createAiService(credentials.access),
    ).catch(() => {}); // Model discovery failure must not discard valid credentials.
  } else {
    updateCachedModelsInBackground(credentials.access);
  }
  return credentials;
};

const refreshToken = async (
  credentials: OAuthCredentials,
): Promise<OAuthCredentials> => {
  const refreshed = await auth.refresh(credentials);
  updateCachedModelsInBackground(refreshed.access);
  return refreshed;
};

export default (pi: ExtensionAPI) => {
  let lastCtx: ExtensionContext | null = null;
  const getCtx = () => lastCtx;

  const state = createStateStore((type, data) => {
    pi.appendEntry(type, data);
  });

  const runtime = createLazyCursorRuntime(pi, getCtx, state);
  const refreshBranchState = async (ctx: ExtensionContext) => {
    lastCtx = ctx;
    await runtime.refreshBranchState(ctx);
  };

  pi.on("before_agent_start", async (_, ctx) => {
    lastCtx = ctx;
  });

  pi.on("agent_start", async (_, ctx) => {
    lastCtx = ctx;
  });

  pi.on("model_select", async (event, ctx) => {
    lastCtx = ctx;
    if (event.model.provider === "cursor-agent") {
      updateCachedModelsFromContextInBackground(ctx);
    }
  });

  pi.on("session_start", async (_, ctx) => {
    await refreshBranchState(ctx);
    updateCachedModelsFromContextInBackground(ctx);
  });

  pi.on("session_switch", async (_, ctx) => {
    await refreshBranchState(ctx);
    updateCachedModelsFromContextInBackground(ctx);
  });

  pi.on("session_tree", async (_, ctx) => {
    await refreshBranchState(ctx);
  });

  pi.on("session_shutdown", async () => {
    await runtime.shutdown();
  });

  pi.on("tool_execution_end", async (event) => {
    resolveToolResult({
      role: "toolResult",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      content: event.result?.content ?? [],
      details: event.result?.details,
      isError: event.isError,
      timestamp: Date.now(),
    });
  });

  pi.registerProvider("cursor-agent", {
    baseUrl: CURSOR_API_URL,
    apiKey: "CURSOR_ACCESS_TOKEN",
    api: "cursor-agent" as unknown as Api,
    streamSimple: (model, context, options) =>
      runtime.stream(model, context, options),
    models: getCachedPiModels(),
    oauth: {
      name: "Cursor",
      login,
      refreshToken,
      getApiKey: (cred) => cred.access,
      // Registration captures a snapshot. Re-read the cache on registry refresh
      // so /models and /scoped-models see models discovered after startup.
      modifyModels: (models) => [
        ...models.filter((model) => model.provider !== "cursor-agent"),
        ...getCachedPiModels(),
      ],
    },
  });
};
