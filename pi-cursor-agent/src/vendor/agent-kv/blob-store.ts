import { createHash } from "node:crypto";
import type { BlobStore } from "./controlled";

function toHex(data: Uint8Array): string {
  return Buffer.from(data).toString("hex");
}

export function getBlobId(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

export class InMemoryBlobStore implements BlobStore {
  private readonly blobs: Map<string, Uint8Array>;

  constructor(blobs?: Map<string, Uint8Array>) {
    this.blobs = blobs ?? new Map<string, Uint8Array>();
  }

  getBlob(_ctx: unknown, blobId: Uint8Array): Promise<Uint8Array | undefined> {
    const blob = this.blobs.get(toHex(blobId));
    return Promise.resolve(blob);
  }

  setBlob(
    _ctx: unknown,
    blobId: Uint8Array,
    blobData: Uint8Array,
  ): Promise<void> {
    this.blobs.set(toHex(blobId), blobData);
    return Promise.resolve();
  }

  get store(): Map<string, Uint8Array> {
    return this.blobs;
  }
}
