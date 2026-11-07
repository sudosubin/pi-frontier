import fs from "node:fs";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelDetails } from "../__generated__/agent/v1/agent_pb";
import { CURSOR_API_URL } from "../lib/env";
import {
  PI_CURSOR_AGENT_CACHE_DIR,
  PI_CURSOR_AGENT_MODELS_CACHE_FILE,
  PI_CURSOR_AGENT_MODELS_CACHE_TTL_MS,
} from "./env";
import { toCanonicalId } from "./model-mapping";
import { findPiModelOverride, type PiModelOverride } from "./model-override";

interface CachedModelsFile {
  models: ModelDetails[];
  lastUpdatedAt?: string;
}

interface ModelService {
  getUsableModels(): Promise<{ models: ModelDetails[] }>;
}

let updateInFlight: Promise<void> | null = null;

const toPiModel = (
  id: string,
  model: ModelDetails,
  override: PiModelOverride,
) => {
  return {
    id,
    name: `${model.displayName} (Cursor)`,
    api: "cursor-agent",
    provider: "cursor-agent",
    baseUrl: CURSOR_API_URL,
    ...override,
  };
};

const readCache = (): CachedModelsFile | undefined => {
  try {
    if (!fs.existsSync(PI_CURSOR_AGENT_MODELS_CACHE_FILE)) {
      return undefined;
    }

    return JSON.parse(
      fs.readFileSync(PI_CURSOR_AGENT_MODELS_CACHE_FILE, "utf8"),
    ) as CachedModelsFile;
  } catch {
    return undefined;
  }
};

const isCacheStale = (cache: CachedModelsFile | undefined): boolean => {
  if (!cache?.lastUpdatedAt) {
    return true;
  }

  const lastUpdatedAt = Date.parse(cache.lastUpdatedAt);
  return (
    Number.isNaN(lastUpdatedAt) ||
    Date.now() - lastUpdatedAt >= PI_CURSOR_AGENT_MODELS_CACHE_TTL_MS
  );
};

export const getCachedPiModels = (): Model<Api>[] => {
  return (readCache()?.models ?? []).flatMap((model) => {
    const canonicalId = toCanonicalId(model.modelId);
    if (!canonicalId) {
      return [];
    }

    const override = findPiModelOverride(canonicalId);
    return [toPiModel(canonicalId, model, override)];
  });
};

export const updateCachedPiModels = async (ai: ModelService) => {
  const [response] = await Promise.all([
    ai.getUsableModels(),
    fs.promises.mkdir(PI_CURSOR_AGENT_CACHE_DIR, { recursive: true }),
  ]);

  const payload: CachedModelsFile = {
    models: response.models,
    lastUpdatedAt: new Date().toISOString(),
  };

  await fs.promises.writeFile(
    PI_CURSOR_AGENT_MODELS_CACHE_FILE,
    JSON.stringify(payload, null, 2),
  );
};

export const updateCachedPiModelsIfStale = async (
  createAi: () => ModelService | Promise<ModelService>,
) => {
  if (updateInFlight) {
    await updateInFlight;
    return;
  }

  if (!isCacheStale(readCache())) {
    return;
  }

  // Check freshness before loading the transport/protobuf graph. The shared
  // promise covers service creation too, not just the subsequent network call.
  updateInFlight = Promise.resolve()
    .then(createAi)
    .then(updateCachedPiModels)
    .finally(() => {
      updateInFlight = null;
    });

  await updateInFlight;
};
