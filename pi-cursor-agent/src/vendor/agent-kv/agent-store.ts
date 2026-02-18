import { ConversationStateStructure } from "../../__generated__/agent/v1/agent_pb";
import { getBlobId } from "./blob-store";
import type { BlobStore } from "./controlled";
import { ProtoSerde } from "./serde";

export const AgentModes = [
  "default",
  "auto-run",
  "plan",
  "background",
  "search",
] as const;

export type AgentMode = (typeof AgentModes)[number];

export interface AgentMetadata {
  agentId: string;
  latestRootBlobId: Uint8Array;
  name: string;
  createdAt: number;
  mode: AgentMode;
  lastUsedModel?: string;
}

export function getDefaultAgentMetadata(agentId?: string): AgentMetadata {
  return {
    agentId: agentId ?? crypto.randomUUID(),
    latestRootBlobId: new Uint8Array(),
    name: "New Agent",
    mode: "default",
    createdAt: Date.now(),
    // lastUsedModel intentionally omitted (optional property)
  };
}

export interface MetadataStore {
  get<K extends keyof AgentMetadata>(key: K): AgentMetadata[K];
  set<K extends keyof AgentMetadata>(key: K, value: AgentMetadata[K]): void;
  subscribe(key: keyof AgentMetadata, listener: () => void): () => void;
}

export class AgentStore {
  private readonly blobStore: BlobStore;
  private readonly metadataStore: MetadataStore;
  conversationStateStructure: ConversationStateStructure;

  private readonly serde = new ProtoSerde(ConversationStateStructure);

  constructor(blobStore: BlobStore, metadataStore: MetadataStore) {
    this.blobStore = blobStore;
    this.metadataStore = metadataStore;
    this.conversationStateStructure = new ConversationStateStructure();
  }

  setMetadata<K extends keyof AgentMetadata>(
    key: K,
    value: AgentMetadata[K],
  ): void {
    this.metadataStore.set(key, value);
  }

  getMetadata<K extends keyof AgentMetadata>(key: K): AgentMetadata[K] {
    return this.metadataStore.get(key);
  }

  getId(): string {
    return this.getMetadata("agentId");
  }

  getBlobStore(): BlobStore {
    return this.blobStore;
  }

  getConversationStateStructure(): ConversationStateStructure {
    return this.conversationStateStructure;
  }

  getLatestCheckpoint(): ConversationStateStructure {
    return this.getConversationStateStructure();
  }

  async handleCheckpoint(
    ctx: unknown,
    checkpoint: ConversationStateStructure,
  ): Promise<void> {
    this.conversationStateStructure = checkpoint;
    const bytes = this.serde.serialize(checkpoint);
    const blobId = getBlobId(bytes);
    await this.blobStore.setBlob(ctx, blobId, bytes);
    this.setMetadata("latestRootBlobId", blobId);
  }

  async resetFromDb(ctx: unknown): Promise<void> {
    try {
      const rootBlobId = this.getMetadata("latestRootBlobId");
      if (!rootBlobId || rootBlobId.length === 0) {
        this.conversationStateStructure = new ConversationStateStructure();
        return;
      }
      const bytes = await this.blobStore.getBlob(ctx, rootBlobId);
      if (!bytes) {
        this.conversationStateStructure = new ConversationStateStructure();
        return;
      }
      this.conversationStateStructure = this.serde.deserialize(bytes);
    } catch {
      this.conversationStateStructure = new ConversationStateStructure();
    }
  }
}
