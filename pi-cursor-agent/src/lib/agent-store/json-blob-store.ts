import {
  type AgentMetadata,
  type BlobStore,
  type MetadataStore,
  toHex,
} from "../../vendor/agent-kv";

export class JsonBlobStoreWithMetadata implements BlobStore, MetadataStore {
  readonly blobs: Map<string, Uint8Array>;
  readonly metadata: AgentMetadata;

  constructor(blobs: Map<string, Uint8Array>, metadata: AgentMetadata) {
    this.blobs = blobs;
    this.metadata = metadata;
  }

  public get<K extends keyof AgentMetadata>(key: K): AgentMetadata[K] {
    return this.metadata[key];
  }

  public set<K extends keyof AgentMetadata>(
    key: K,
    value: AgentMetadata[K],
  ): void {
    this.metadata[key] = value;
  }

  public subscribe(_: keyof AgentMetadata, __: () => void): () => void {
    return () => {};
  }

  public async getBlob(
    _: unknown,
    blobId: Uint8Array,
  ): Promise<Uint8Array | undefined> {
    return Promise.resolve(this.blobs.get(toHex(blobId)));
  }

  public setBlob(
    _ctx: unknown,
    blobId: Uint8Array,
    blobData: Uint8Array,
  ): Promise<void> {
    this.blobs.set(toHex(blobId), blobData);
    return Promise.resolve();
  }
}
