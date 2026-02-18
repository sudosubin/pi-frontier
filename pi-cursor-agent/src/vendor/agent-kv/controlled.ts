import {
  GetBlobResult,
  KvClientMessage,
  type KvServerMessage,
  SetBlobResult,
} from "../../__generated__/agent/v1/kv_pb";

export interface Writable<T> {
  write(value: T): Promise<void>;
}

export interface BlobStore {
  getBlob(ctx: unknown, blobId: Uint8Array): Promise<Uint8Array | undefined>;
  setBlob(
    ctx: unknown,
    blobId: Uint8Array,
    blobData: Uint8Array,
  ): Promise<void>;
}

// Makes new Uint8Array, sharing the underlying buffer if possible,
// outputting a Uint8Array<ArrayBuffer> for use in crypto libraries and such.
// Only use if the Uint8Array is effectively immutable.
function toUint8Array(b: Uint8Array): Uint8Array {
  const buffer = b.buffer;
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    buffer instanceof SharedArrayBuffer
  ) {
    return new Uint8Array(b);
  }
  return new Uint8Array(buffer, b.byteOffset, b.byteLength);
}

export class ControlledKvManager {
  private readonly serverStream: AsyncIterable<KvServerMessage>;
  private readonly clientStream: Writable<KvClientMessage>;
  private readonly blobStore: BlobStore;

  constructor(
    serverStream: AsyncIterable<KvServerMessage>,
    clientStream: Writable<KvClientMessage>,
    blobStore: BlobStore,
  ) {
    this.serverStream = serverStream;
    this.clientStream = clientStream;
    this.blobStore = blobStore;
  }

  async run(parentCtx: unknown): Promise<void> {
    const baseCtx = parentCtx;
    for await (const message of this.serverStream) {
      switch (message.message.case) {
        case "getBlobArgs": {
          const blobId = message.message.value.blobId;
          // Wrap in async function so spans live for the duration of the async operation
          void (async () => {
            const ctx = baseCtx;
            try {
              const response = await this.blobStore.getBlob(ctx, blobId);
              await this.clientStream.write(
                new KvClientMessage({
                  id: message.id,
                  message: {
                    case: "getBlobResult",
                    value: new GetBlobResult(
                      response ? { blobData: toUint8Array(response) } : {},
                    ),
                  },
                }),
              );
            } catch (_error) {}
          })();
          break;
        }

        case "setBlobArgs": {
          const blobId = message.message.value.blobId;
          const blobData = message.message.value.blobData;
          // Wrap in async function so spans live for the duration of the async operation
          void (async () => {
            const ctx = baseCtx;
            try {
              await this.blobStore.setBlob(ctx, blobId, blobData);
              await this.clientStream.write(
                new KvClientMessage({
                  id: message.id,
                  message: {
                    case: "setBlobResult",
                    value: new SetBlobResult({}),
                  },
                }),
              );
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              try {
                await this.clientStream.write(
                  new KvClientMessage({
                    id: message.id,
                    message: {
                      case: "setBlobResult",
                      value: new SetBlobResult({
                        error: { message: errorMessage },
                      }),
                    },
                  }),
                );
              } catch (_writeError) {}
            }
          })();
          break;
        }
      }
    }
  }
}
