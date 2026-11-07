// Loaded only by startup.py. No credentials, LLM requests, or user settings are used.
import { writeFileSync } from "node:fs";
import type { ExtensionAPI, ProviderConfig } from "@mariozechner/pi-coding-agent";

export default async function (pi: ExtensionAPI) {
  const source = process.env["CURSOR_BENCH_ENTRY"];
  if (!source) throw new Error("CURSOR_BENCH_ENTRY is required");
  const { default: extension } = await import(source);
  let provider: ProviderConfig | undefined;
  await extension({
    ...pi,
    registerProvider(name: string, config: ProviderConfig) {
      if (name === "cursor-agent") provider = config;
      pi.registerProvider(name, config);
    },
  });
  pi.registerCommand("cursor-load-speed-probe", {
    description: "Measure local Cursor initialization without making an API request",
    handler: async (_args, ctx) => {
      if (!provider?.streamSimple || !provider.models?.[0]) {
        throw new Error("Cursor provider was not registered with a cached model");
      }
      const runs = [];
      for (let i = 0; i < 2; i++) {
        const start = performance.now();
        const stream = provider.streamSimple(
          { ...provider.models[0], api: "cursor-agent", provider: "cursor-agent" } as never,
          { messages: [] },
          { sessionId: ctx.sessionManager.getSessionId() },
        );
        const returnedMs = performance.now() - start;
        const result = await stream.result();
        if (result.stopReason !== "error" || !result.errorMessage?.includes("Cursor API key")) {
          throw new Error(`Unexpected probe result: ${JSON.stringify(result)}`);
        }
        runs.push({ returned_ms: returnedMs, completed_ms: performance.now() - start });
      }
      writeFileSync(process.env["CURSOR_BENCH_RESULT"]!, JSON.stringify(runs));
    },
  });
}
