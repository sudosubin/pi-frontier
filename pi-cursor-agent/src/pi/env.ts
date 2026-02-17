import os from "node:os";
import path from "node:path";

const PI_CODING_AGENT_DIR =
  process.env["PI_CODING_AGENT_DIR"] || path.join(os.homedir(), ".pi", "agent");

export const PI_CURSOR_AGENT_CACHE_DIR = path.join(
  PI_CODING_AGENT_DIR,
  "cache",
  "pi-cursor-agent",
);

export const PI_CURSOR_AGENT_MODELS_CACHE_FILE = path.join(
  PI_CURSOR_AGENT_CACHE_DIR,
  "models.json",
);

export const PI_CURSOR_AGENT_MODELS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
