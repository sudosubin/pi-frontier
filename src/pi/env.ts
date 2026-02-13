import os from "node:os";
import path from "node:path";

const PI_CODING_AGENT_DIR =
  process.env["PI_CODING_AGENT_DIR"] || path.join(os.homedir(), ".pi", "agent");

export const PI_CURSOR_AGENT_CACHE_DIR = path.join(
  PI_CODING_AGENT_DIR,
  "cache",
  "pi-cursor-agent",
);
