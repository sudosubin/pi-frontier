import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

test("provider registration and lifecycle events with a fresh cache do not import the heavy graph", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cursor-import-test-"),
  );
  try {
    const cache = path.join(directory, "cache", "pi-cursor-agent");
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(
      path.join(cache, "models.json"),
      JSON.stringify({
        models: [{ modelId: "composer-2", displayName: "Composer 2" }],
        lastUpdatedAt: new Date().toISOString(),
      }),
    );
    const script = `
      import assert from "node:assert/strict";
      import { registerHooks } from "node:module";
      import { pathToFileURL } from "node:url";
      const attempted = [];
      const root = pathToFileURL(process.cwd() + "/src/").href;
      registerHooks({
        resolve(specifier, context, next) {
          const result = next(specifier, context);
          if (result.url.startsWith(root) && (
            /\\/(api\\/ai-service|provider\\/(runtime|stream|agent-store|session-lifecycle))\\.[jt]s$/.test(result.url) ||
            /\\/(__generated__|vendor)\\//.test(result.url)
          )) {
            attempted.push(result.url);
            throw new Error("Unexpected eager import: " + result.url);
          }
          return result;
        }
      });
      const { default: extension } = await import("./src/index.ts");
      const handlers = new Map();
      let provider;
      extension({
        on(event, handler) { handlers.set(event, handler); },
        registerProvider(name, config) { assert.equal(name, "cursor-agent"); provider = config; },
        appendEntry() { throw new Error("Startup must not persist entries"); }
      });
      assert.equal(provider.models[0].id, "composer-2");
      assert.equal(typeof provider.streamSimple, "function");
      assert.equal(typeof provider.oauth.login, "function");
      assert.equal(typeof provider.oauth.refreshToken, "function");
      const ctx = {
        sessionManager: { getSessionId: () => "session", getBranch: () => [] },
        modelRegistry: { getApiKeyForProvider: async () => "unused-test-token" }
      };
      for (const event of ["session_start", "session_switch", "session_tree", "before_agent_start", "agent_start"]) {
        await handlers.get(event)({}, ctx);
      }
      await handlers.get("model_select")({ model: { provider: "cursor-agent" } }, ctx);
      await handlers.get("tool_execution_end")({ toolCallId: "unrelated", result: { content: [] } }, ctx);
      await handlers.get("session_shutdown")({}, ctx);
      await new Promise(setImmediate);
      assert.deepEqual(attempted, []);
      console.log("lightweight registration verified");
    `;
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      {
        cwd: packageRoot,
        env: { ...process.env, PI_CODING_AGENT_DIR: directory },
        encoding: "utf8",
        timeout: 15000,
      },
    );
    assert.match(output, /lightweight registration verified/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
