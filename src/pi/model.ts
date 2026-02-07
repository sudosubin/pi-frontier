import fs from "node:fs";
import path from "node:path";
import { Api, Model } from "@mariozechner/pi-ai";
import {
  GetUsableModelsResponse,
  ModelDetails,
} from "../__generated__/agent/v1/agent_pb";
import AiService from "../api/ai-service";
import { CURSOR_API_URL } from "../lib/env";
import { PI_CURSOR_AGENT_CACHE_DIR } from "./env";
import { toCanonicalId } from "./model-mapping";
import { findPiModelOverride, PiModelOverride } from "./model-override";

const applyPiModelOverride = (
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

export const getCachedPiModels = (): Model<Api>[] => {
  const cachedPath = path.join(PI_CURSOR_AGENT_CACHE_DIR, "models.json");

  try {
    if (fs.existsSync(cachedPath)) {
      const raw = fs.readFileSync(cachedPath, "utf8");
      const response = JSON.parse(raw) as GetUsableModelsResponse;
      return response.models
        .map((model) => ({
          model,
          canonicalId: toCanonicalId(model.modelId),
        }))
        .filter(
          (entry): entry is { model: ModelDetails; canonicalId: string } =>
            entry.canonicalId !== null,
        )
        .map(({ model, canonicalId }) => {
          const override = findPiModelOverride(canonicalId);
          return applyPiModelOverride(canonicalId, model, override);
        });
    }
  } catch {}
  return [];
};

export const updateCachedPiModels = async (ai: AiService) => {
  const [response] = await Promise.all([
    await ai.getUsableModels(),
    fs.promises.mkdir(PI_CURSOR_AGENT_CACHE_DIR, { recursive: true }),
  ]);
  const cachedPath = path.join(PI_CURSOR_AGENT_CACHE_DIR, "models.json");
  await fs.promises.writeFile(cachedPath, JSON.stringify(response, null, 2));
};
