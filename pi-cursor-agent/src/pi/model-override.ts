import type { Api, Model } from "@mariozechner/pi-ai";

export type PiModelOverride = Pick<
  Model<Api>,
  "reasoning" | "input" | "cost" | "contextWindow" | "maxTokens"
>;

export const findPiModelOverride = (id: string): PiModelOverride => {
  const matched = overrides.find((m) => m.id.test(id));
  if (!matched) {
    throw new Error(`No model override found for id: ${id}`);
  }

  const { id: _, ...override } = matched;
  return override;
};

const overrides = [
  {
    id: /^composer-1$/,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
    contextWindow: 200000,
    maxTokens: 64000, // TODO
  },
  {
    id: /^composer-1\.5$/,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 3.5, output: 17.5, cacheRead: 0.35, cacheWrite: 4.375 },
    contextWindow: 200000,
    maxTokens: 64000, // TODO
  },
  {
    id: /^claude-sonnet-4-5$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: /^claude-opus-4-5$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    contextWindow: 200000,
    maxTokens: 32000,
  },
  {
    id: /^claude-opus-4-6$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: /^gpt-5\.2-codex(-fast)?$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
  {
    id: /^gpt-5\.3-codex(-fast)?$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: /^gpt-5\.2$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: /^gpt-5\.1$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 15, output: 60, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 272000,
  },
  {
    id: /^gpt-5\.1-codex-max$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    id: /^gemini-3-flash-preview$/,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
  },
  {
    id: /^gemini-3-pro-preview$/,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
  },
  {
    id: /^grok-code-fast-1$/,
    reasoning: false,
    input: ["text"],
    cost: { input: 5, output: 15, cacheRead: 5, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 4096,
  },
  {
    id: /^.*$/,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 1.25, output: 6, cacheRead: 0.25, cacheWrite: 1.25 },
    contextWindow: 200000,
    maxTokens: 30000, // TODO
  },
] satisfies (PiModelOverride & { id: RegExp })[];
