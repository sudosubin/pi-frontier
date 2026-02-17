import type { Message } from "@bufbuild/protobuf";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class Utf8Serde {
  serialize(value: string): Uint8Array {
    return encoder.encode(value);
  }
  deserialize(blob: Uint8Array): string {
    return decoder.decode(blob);
  }
}

export const utf8Serde = new Utf8Serde();

export class ProtoSerde<T extends Message> {
  private readonly proto: {
    fromBinary(bytes: Uint8Array): T;
  };
  constructor(proto: { fromBinary(bytes: Uint8Array): T }) {
    this.proto = proto;
  }
  serialize(value: T): Uint8Array {
    return (value as Message).toBinary();
  }
  deserialize(blob: Uint8Array): T {
    return this.proto.fromBinary(blob);
  }
}

export function toHex(u8: Uint8Array): string {
  return Buffer.from(u8).toString("hex");
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0) throw new Error("Invalid hex string length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}
