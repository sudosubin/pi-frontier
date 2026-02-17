import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { ConversationStateStructure } from "../__generated__/agent/v1/agent_pb";
import { AgentStore, toHex, fromHex } from "../vendor/agent-kv";
import {
  ensureAgentStore as ensureStore,
  persistAgentStore as persistStore,
  applySnapshotToStore,
} from "../lib/agent-store";
import { PI_CURSOR_AGENT_CACHE_DIR } from "./env";

export const CURSOR_STATE_ENTRY_TYPE = "pi-cursor-agent:state";

interface AgentStoreSnapshot {
  version: 1;
  agentId: string;
  latestRootBlobId: string;
  conversationState?: string;
}

const findSnapshot = (entries: SessionEntry[]): AgentStoreSnapshot | null => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.type !== "custom" || e.customType !== CURSOR_STATE_ENTRY_TYPE) {
      continue;
    }
    const d = e.data as Record<string, unknown> | null;
    if (
      d != null &&
      d["version"] === 1 &&
      typeof d["agentId"] === "string" &&
      typeof d["latestRootBlobId"] === "string"
    ) {
      return d as unknown as AgentStoreSnapshot;
    }
  }
  return null;
};

export const ensureAgentStore = async (
  sessionId: string,
): Promise<AgentStore> => {
  const entry = await ensureStore(PI_CURSOR_AGENT_CACHE_DIR, sessionId);
  return entry.store;
};

export const persistAgentStore = async (
  sessionId: string,
): Promise<AgentStoreSnapshot | null> => {
  const entry = await persistStore(PI_CURSOR_AGENT_CACHE_DIR, sessionId);
  if (!entry) {
    return null;
  }

  const {
    store,
    jsonStore: { metadata },
  } = entry;
  const snapshot: AgentStoreSnapshot = {
    version: 1,
    agentId: metadata.agentId,
    latestRootBlobId: toHex(metadata.latestRootBlobId),
  };

  try {
    const bytes = store.getConversationStateStructure().toBinary();
    if (bytes.length > 0) {
      snapshot.conversationState = Buffer.from(bytes).toString("base64");
    }
  } catch {}

  return snapshot;
};

export const restoreAgentStoreFromBranch = async (
  sessionId: string,
  entries: SessionEntry[],
): Promise<void> => {
  const snapshot = findSnapshot(entries);
  if (!snapshot) {
    return;
  }

  const storeEntry = await ensureStore(PI_CURSOR_AGENT_CACHE_DIR, sessionId);
  const rootBlobId = snapshot.latestRootBlobId
    ? fromHex(snapshot.latestRootBlobId)
    : new Uint8Array();

  if (rootBlobId.length > 0) {
    await applySnapshotToStore(storeEntry, snapshot.agentId, rootBlobId);
    return;
  }

  if (snapshot.conversationState) {
    storeEntry.jsonStore.metadata.agentId = snapshot.agentId;
    try {
      storeEntry.store.conversationStateStructure =
        ConversationStateStructure.fromBinary(
          Buffer.from(snapshot.conversationState, "base64"),
        );
    } catch {}
  }
};
