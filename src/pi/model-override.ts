import { Api, Model } from "@mariozechner/pi-ai";

export type PiModelOverride = Pick<
  Model<Api>,
  "reasoning" | "input" | "cost" | "contextWindow" | "maxTokens"
>;

export const findPiModelOverride = (id: string): PiModelOverride => {
  const { id: _, ...override } = overrides.find((m) => m.id.test(id))!;
  return override;
};

const overrides = [
  {
    id: /^composer-1$/,
    reasoning: false,
    input: ["text"],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
    contextWindow: 200000,
    maxTokens: 64000, // TODO
  },
  {
    id: /^claude-4\.5-opus.*$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: /^claude-4\.6-opus.*$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 200000,
    maxTokens: 128000,
  },
  {
    id: /^claude-4\.5-sonnet.*$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: /^gemini-3-flash$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.5 },
    contextWindow: 200000,
    maxTokens: 64000, // TODO
  },
  {
    id: /^gemini-3-pro$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2 },
    contextWindow: 200000,
    maxTokens: 64000, // TODO
  },
  {
    id: /^gpt-5\.1.*$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
    contextWindow: 272000,
    maxTokens: 128000,
  },
  {
    id: /^gpt-5\.2.*$/,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 1.75 },
    contextWindow: 272000,
    maxTokens: 128000,
  },
  {
    id: /^grok-code-fast-1$/,
    reasoning: true,
    input: ["text"],
    cost: { input: 0.2, output: 1.5, cacheRead: 0.02, cacheWrite: 0.2 },
    contextWindow: 256000,
    maxTokens: 10000,
  },
  {
    id: /^.*$/,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 1.25, output: 6, cacheRead: 0.25, cacheWrite: 1.25 },
    contextWindow: 2000000, // TODO
    maxTokens: 30000, // TODO
  },
] satisfies (PiModelOverride & { id: RegExp })[];
