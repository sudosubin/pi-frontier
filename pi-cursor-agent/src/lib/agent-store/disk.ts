import fs from "node:fs/promises";
import path from "node:path";
import { type AgentMetadata, fromHex, toHex } from "../../vendor/agent-kv";

interface BlobEntry {
  id: string;
  data: string;
}

interface BlobsFile {
  version: 1;
  blobs: BlobEntry[];
}

interface MetaFile {
  version: 1;
  agentId: string;
  latestRootBlobId: string;
  name: string;
  createdAt: number;
  mode: string;
  lastUsedModel?: string;
}

const getSessionDir = (baseDir: string, sessionId: string): string =>
  path.join(baseDir, "chats", sessionId);

const getBlobsFilePath = (baseDir: string, sessionId: string): string =>
  path.join(getSessionDir(baseDir, sessionId), "blobs.json");

const getMetaFilePath = (baseDir: string, sessionId: string): string =>
  path.join(getSessionDir(baseDir, sessionId), "meta.json");

export const loadBlobsFromDisk = async (
  baseDir: string,
  sessionId: string,
): Promise<Map<string, Uint8Array>> => {
  try {
    const text = await fs.readFile(
      getBlobsFilePath(baseDir, sessionId),
      "utf-8",
    );
    const parsed = JSON.parse(text) as BlobsFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.blobs)) {
      return new Map();
    }
    const map = new Map<string, Uint8Array>();
    for (const entry of parsed.blobs) {
      if (
        !entry ||
        typeof entry.id !== "string" ||
        typeof entry.data !== "string"
      )
        continue;
      try {
        map.set(entry.id, new Uint8Array(Buffer.from(entry.data, "base64")));
      } catch {
        // skip corrupt entries
      }
    }
    return map;
  } catch {
    return new Map();
  }
};

export const saveBlobsToDisk = async (
  baseDir: string,
  sessionId: string,
  blobs: Map<string, Uint8Array>,
): Promise<void> => {
  const dir = getSessionDir(baseDir, sessionId);
  await fs.mkdir(dir, { recursive: true });
  const file: BlobsFile = {
    version: 1,
    blobs: Array.from(blobs.entries()).map(([id, data]) => ({
      id,
      data: Buffer.from(data).toString("base64"),
    })),
  };
  const filePath = getBlobsFilePath(baseDir, sessionId);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(file), "utf-8");
  await fs.rename(tmpPath, filePath);
};

export const loadMetaFromDisk = async (
  baseDir: string,
  sessionId: string,
): Promise<AgentMetadata | null> => {
  try {
    const text = await fs.readFile(
      getMetaFilePath(baseDir, sessionId),
      "utf-8",
    );
    const parsed = JSON.parse(text) as MetaFile;
    if (!parsed || parsed.version !== 1 || typeof parsed.agentId !== "string") {
      return null;
    }
    return {
      agentId: parsed.agentId,
      latestRootBlobId: parsed.latestRootBlobId
        ? fromHex(parsed.latestRootBlobId)
        : new Uint8Array(),
      name: parsed.name ?? "New Agent",
      createdAt: parsed.createdAt ?? Date.now(),
      mode: (parsed.mode as AgentMetadata["mode"]) ?? "default",
      ...(parsed.lastUsedModel != null && {
        lastUsedModel: parsed.lastUsedModel,
      }),
    };
  } catch {
    return null;
  }
};

export const saveMetaToDisk = async (
  baseDir: string,
  sessionId: string,
  metadata: AgentMetadata,
): Promise<void> => {
  const dir = getSessionDir(baseDir, sessionId);
  await fs.mkdir(dir, { recursive: true });
  const file: MetaFile = {
    version: 1,
    agentId: metadata.agentId,
    latestRootBlobId: toHex(metadata.latestRootBlobId),
    name: metadata.name,
    createdAt: metadata.createdAt,
    mode: metadata.mode,
    ...(metadata.lastUsedModel != null && {
      lastUsedModel: metadata.lastUsedModel,
    }),
  };
  const filePath = getMetaFilePath(baseDir, sessionId);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(file), "utf-8");
  await fs.rename(tmpPath, filePath);
};
