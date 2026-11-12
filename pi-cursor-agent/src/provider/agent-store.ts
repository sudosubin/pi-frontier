import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { ConversationStateStructure } from "../__generated__/agent/v1/agent_pb";
import {
  deleteAgentStore as deleteStore,
  ensureAgentStore as ensureStore,
  persistAgentStore as persistStore,
} from "../lib/agent-store";
import { type AgentStore, fromHex, toHex } from "../vendor/agent-kv";
import { PI_CURSOR_AGENT_CACHE_DIR } from "./env";

export const CURSOR_STATE_ENTRY_TYPE = "pi-cursor-agent:state";

interface AgentStoreSnapshot {
  version: 1;
  agentId: string;
  latestRootBlobId: string;
  conversationState?: string;
}

const isAgentStoreSnapshot = (value: unknown): value is AgentStoreSnapshot => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const snapshot = value as Partial<AgentStoreSnapshot>;
  return (
    snapshot.version === 1 &&
    typeof snapshot.agentId === "string" &&
    typeof snapshot.latestRootBlobId === "string"
  );
};

const findSnapshot = (entries: SessionEntry[]): AgentStoreSnapshot | null => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e || e.type !== "custom" || e.customType !== CURSOR_STATE_ENTRY_TYPE) {
      continue;
    }

    if (isAgentStoreSnapshot(e.data)) {
      return e.data;
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

export const evictAgentStore = async (
  sessionId: string,
  options?: { persist?: boolean },
): Promise<void> => {
  try {
    if (options?.persist !== false) {
      await persistStore(PI_CURSOR_AGENT_CACHE_DIR, sessionId);
    }
  } finally {
    deleteStore(sessionId);
  }
};

export const restoreAgentStoreFromBranch = async (
  sessionId: string,
  entries: SessionEntry[],
): Promise<void> => {
  const snapshot = findSnapshot(entries);
  const storeEntry = await ensureStore(PI_CURSOR_AGENT_CACHE_DIR, sessionId);
  if (!snapshot) {
    // A branch before its first Cursor turn must not inherit the latest disk
    // checkpoint from a different branch of the same Pi session.
    storeEntry.jsonStore.metadata.agentId = crypto.randomUUID();
    storeEntry.jsonStore.metadata.latestRootBlobId = new Uint8Array();
    storeEntry.store.conversationStateStructure =
      new ConversationStateStructure();
    return;
  }
  if (
    snapshot.latestRootBlobId &&
    !/^(?:[0-9a-fA-F]{2})+$/.test(snapshot.latestRootBlobId)
  ) {
    throw new Error("Invalid Cursor checkpoint blob id");
  }
  const rootBlobId = snapshot.latestRootBlobId
    ? fromHex(snapshot.latestRootBlobId)
    : new Uint8Array();

  // Decode before mutating metadata. The vendor resetFromDb intentionally
  // tolerates missing/corrupt blobs, which is unsafe for explicit branch restore.
  let restored = new ConversationStateStructure();
  if (rootBlobId.length > 0) {
    const bytes = await storeEntry.jsonStore.getBlob(null, rootBlobId);
    if (!bytes)
      throw new Error(
        "Cursor checkpoint blob is missing; restore the session cache before retrying",
      );
    restored = ConversationStateStructure.fromBinary(bytes);
  } else if (snapshot.conversationState) {
    restored = ConversationStateStructure.fromBinary(
      Buffer.from(snapshot.conversationState, "base64"),
    );
  }
  storeEntry.jsonStore.metadata.agentId = snapshot.agentId;
  storeEntry.jsonStore.metadata.latestRootBlobId = rootBlobId;
  storeEntry.store.conversationStateStructure = restored;
};
