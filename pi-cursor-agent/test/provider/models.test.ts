import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import type { ModelDetails } from "../../src/__generated__/agent/v1/agent_pb.js";

// Each node:test file runs in its own process; never touch the real model cache.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-models-test-"));
process.env["PI_CODING_AGENT_DIR"] = directory;
const { getCachedPiModels, updateCachedPiModelsIfStale } = await import(
  "../../src/provider/models.js"
);
const { PI_CURSOR_AGENT_MODELS_CACHE_FILE: cacheFile } = await import(
  "../../src/provider/env.js"
);
after(() => fs.rmSync(directory, { recursive: true, force: true }));

const model = {
  modelId: "composer-2",
  displayName: "Composer 2",
} as ModelDetails;
function cache(lastUpdatedAt?: string) {
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({ models: [model], lastUpdatedAt }),
  );
}
function service() {
  let calls = 0;
  return {
    async getUsableModels() {
      calls++;
      return { models: [model] };
    },
    calls: () => calls,
  };
}

test("fresh cached models are available synchronously without constructing AiService", async () => {
  cache(new Date().toISOString());
  assert.equal(getCachedPiModels()[0]?.id, "composer-2");
  await updateCachedPiModelsIfStale(() => {
    throw new Error("A fresh cache must not load or construct AiService");
  });
});

test("expired, missing, malformed, and undated caches trigger service creation", async (t) => {
  const cases = {
    expired: () =>
      cache(new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000).toISOString()),
    missing: () => fs.rmSync(cacheFile, { force: true }),
    malformed: () => fs.writeFileSync(cacheFile, "not json"),
    undated: () => cache(),
    invalidDate: () => cache("invalid date"),
  };
  for (const [name, prepare] of Object.entries(cases)) {
    await t.test(name, async () => {
      prepare();
      const ai = service();
      let creations = 0;
      await updateCachedPiModelsIfStale(async () => {
        creations++;
        return ai;
      });
      assert.equal(creations, 1);
      assert.equal(ai.calls(), 1);
      const updated = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      assert.equal(updated.models[0].modelId, "composer-2");
      assert.ok(Date.parse(updated.lastUpdatedAt) <= Date.now());
    });
  }
});

test("simultaneous refreshes share service loading, construction, and the fetch", async () => {
  cache();
  const ai = service();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let creations = 0;
  const create = async () => {
    creations++;
    await gate;
    return ai;
  };
  const first = updateCachedPiModelsIfStale(create);
  const second = updateCachedPiModelsIfStale(create);
  await Promise.resolve();
  assert.equal(creations, 1);
  assert.equal(ai.calls(), 0);
  // Stale models remain usable while the background refresh is pending.
  assert.equal(getCachedPiModels()[0]?.id, "composer-2");
  release();
  await Promise.all([first, second]);
  assert.equal(ai.calls(), 1);
  await updateCachedPiModelsIfStale(() => {
    throw new Error("cache is now fresh");
  });
});

test("failed service loading clears the shared promise and permits a retry", async () => {
  cache();
  await assert.rejects(
    updateCachedPiModelsIfStale(async () => {
      throw new Error("module unavailable");
    }),
    /module unavailable/,
  );
  const ai = service();
  await updateCachedPiModelsIfStale(() => ai);
  assert.equal(ai.calls(), 1);
});

test("failed fetch preserves the cache and permits a retry", async () => {
  cache();
  const original = fs.readFileSync(cacheFile, "utf8");
  await assert.rejects(
    updateCachedPiModelsIfStale(() => ({
      async getUsableModels() {
        throw new Error("offline");
      },
    })),
    /offline/,
  );
  assert.equal(fs.readFileSync(cacheFile, "utf8"), original);
  const ai = service();
  await updateCachedPiModelsIfStale(() => ai);
  assert.equal(ai.calls(), 1);
});
