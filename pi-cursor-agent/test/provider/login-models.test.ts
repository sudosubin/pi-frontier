import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, afterEach, mock } from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

// Exercise the real login/storage/registry sequence without touching user data
// or making authentication/model-discovery network requests.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-login-test-"));
process.env["PI_CODING_AGENT_DIR"] = directory;
const { AuthStorage, ModelRegistry } = await import(
  "@mariozechner/pi-coding-agent"
);
const { GetUsableModelsResponse } = await import(
  "../../src/__generated__/agent/v1/agent_pb.js"
);
const { default: AiService } = await import("../../src/api/ai-service.js");
const { default: AuthManager } = await import("../../src/lib/auth.js");
const { default: extension } = await import("../../src/index.js");
const { PI_CURSOR_AGENT_MODELS_CACHE_FILE: cacheFile } = await import(
  "../../src/provider/env.js"
);
afterEach(() => mock.restoreAll());
after(() => fs.rmSync(directory, { recursive: true, force: true }));

const credentials = {
  access: "test-access-token",
  refresh: "test-refresh-token",
  expires: Date.now() + 3600_000,
};
const callbacks = { onAuth() {}, onPrompt: async () => "" };
const response = new GetUsableModelsResponse({
  models: [{ modelId: "composer-2", displayName: "Composer 2" }],
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function cache(id: string, fresh = true) {
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({
      models: [{ modelId: id, displayName: id }],
      lastUpdatedAt: new Date(fresh ? Date.now() : 0).toISOString(),
    }),
  );
}

function setup() {
  fs.rmSync(cacheFile, { force: true });
  const authPath = path.join(directory, "auth.json");
  fs.rmSync(authPath, { force: true });
  const auth = new AuthStorage(authPath);
  const registry = new ModelRegistry(auth, path.join(directory, "models.json"));
  const handlers = new Map<
    string,
    (event: unknown, ctx: ExtensionContext) => Promise<void>
  >();
  const register = () =>
    extension({
      on(
        event: string,
        handler: (event: unknown, ctx: ExtensionContext) => Promise<void>,
      ) {
        handlers.set(event, handler);
      },
      registerProvider(
        name: string,
        config: Parameters<ExtensionAPI["registerProvider"]>[1],
      ) {
        registry.registerProvider(name, config);
      },
      appendEntry() {
        throw new Error("Model discovery must not persist session entries");
      },
    } as unknown as ExtensionAPI);
  mock.method(AuthManager.prototype, "login", async () => credentials);
  return { auth, registry, handlers, register };
}

function cursorIds(registry: InstanceType<typeof ModelRegistry>) {
  return registry
    .getAvailable()
    .filter((model) => model.provider === "cursor-agent")
    .map((model) => model.id);
}

test("first login waits for discovery and registry refresh exposes models without reload", async () => {
  const { auth, registry, handlers, register } = setup();
  const started = gate();
  const fetch = gate();
  const discovery = mock.method(
    AiService.prototype,
    "getUsableModels",
    async () => {
      started.release();
      await fetch.promise;
      return response;
    },
  );
  register();
  const ctx = {
    sessionManager: { getSessionId: () => "test", getBranch: () => [] },
    modelRegistry: { getApiKeyForProvider: async () => undefined },
  } as unknown as ExtensionContext;
  await handlers.get("session_start")?.({}, ctx);
  await new Promise(setImmediate);
  assert.equal(discovery.mock.callCount(), 0, "no discovery before login");
  assert.deepEqual(cursorIds(registry), []);

  let loggedIn = false;
  const login = auth.login("cursor-agent", callbacks).then(() => {
    loggedIn = true;
  });
  await started.promise;
  try {
    assert.equal(loggedIn, false, "login must wait for the first catalog");
  } finally {
    fetch.release();
  }
  await login;
  // Pi refreshes after /login and when opening its model selectors.
  registry.refresh();
  assert.deepEqual(cursorIds(registry), ["composer-2"]);
  registry.refresh();
  assert.deepEqual(cursorIds(registry), ["composer-2"]);
  assert.equal(discovery.mock.callCount(), 1);
  assert.equal(auth.get("cursor-agent")?.type, "oauth");
});

test("fresh cached models need no discovery during login", async () => {
  const { auth, registry, register } = setup();
  cache("composer-1.5");
  const discovery = mock.method(
    AiService.prototype,
    "getUsableModels",
    async () => {
      throw new Error("fresh cache must not fetch");
    },
  );
  register();
  await auth.login("cursor-agent", callbacks);
  registry.refresh();
  assert.deepEqual(cursorIds(registry), ["composer-1.5"]);
  assert.equal(discovery.mock.callCount(), 0);
});

test("stale cached models remain usable during background discovery and selectors read the result", async () => {
  const { auth, registry, register } = setup();
  cache("composer-1.5", false);
  const fetch = gate();
  mock.method(AiService.prototype, "getUsableModels", async () => {
    await fetch.promise;
    return response;
  });
  register();
  try {
    await auth.login("cursor-agent", callbacks);
    registry.refresh();
    assert.deepEqual(cursorIds(registry), ["composer-1.5"]);
  } finally {
    fetch.release();
  }
  // Join the same in-flight discovery to wait for the cache write as well.
  const { updateCachedPiModelsIfStale } = await import(
    "../../src/provider/models.js"
  );
  await updateCachedPiModelsIfStale(() => {
    throw new Error("must share the background discovery");
  });
  registry.refresh();
  assert.deepEqual(cursorIds(registry), ["composer-2"]);
  assert.ok(
    registry.getAll().some((model) => model.provider !== "cursor-agent"),
  );
});

test("failed first discovery still saves credentials and a later login retries", async () => {
  const { auth, registry, register } = setup();
  const discovery = mock.method(
    AiService.prototype,
    "getUsableModels",
    async () => {
      throw new Error("offline");
    },
  );
  register();
  await auth.login("cursor-agent", callbacks);
  registry.refresh();
  assert.deepEqual(auth.get("cursor-agent"), { type: "oauth", ...credentials });
  assert.deepEqual(cursorIds(registry), []);
  discovery.mock.restore();
  mock.method(AiService.prototype, "getUsableModels", async () => response);
  await auth.login("cursor-agent", callbacks);
  registry.refresh();
  assert.deepEqual(cursorIds(registry), ["composer-2"]);
});
