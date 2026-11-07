import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { CursorStateStore } from "./state";

export interface CursorRuntime {
  refreshBranchState(ctx: ExtensionContext): Promise<void>;
  stream(
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream;
  shutdown(): Promise<void>;
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function createLazyCursorRuntime(
  pi: ExtensionAPI,
  getCtx: () => ExtensionContext | null,
  state: CursorStateStore,
  loadRuntime: () => Promise<CursorRuntime> = async () => {
    const { createCursorRuntime } = await import("./runtime");
    return createCursorRuntime(pi, getCtx, state);
  },
): CursorRuntime {
  let pendingCtx: ExtensionContext | null = null;
  let branchVersion = 0;
  let restoredVersion = -1;
  let disposed = false;
  let runtimePromise: Promise<CursorRuntime> | null = null;
  let branchWork: Promise<void> = Promise.resolve();

  const ensureRuntime = () => {
    if (!runtimePromise) {
      // Publish the promise before invoking the loader; concurrent requests share it.
      runtimePromise = Promise.resolve()
        .then(loadRuntime)
        .catch((error: unknown) => {
          runtimePromise = null;
          throw error;
        });
    }
    return runtimePromise;
  };

  const syncBranch = (runtime: CursorRuntime) => {
    const work = branchWork.then(async () => {
      while (!disposed && restoredVersion !== branchVersion) {
        const version = branchVersion;
        const ctx = pendingCtx ?? getCtx();
        if (ctx) await runtime.refreshBranchState(ctx);
        restoredVersion = version;
      }
    });
    // Keep later refreshes usable even when a previous operation failed.
    branchWork = work.catch(() => {});
    return work;
  };

  return {
    async refreshBranchState(ctx) {
      if (disposed) return;
      pendingCtx = ctx;
      branchVersion++;
      // Session startup/tree navigation must not cause a first runtime import.
      if (runtimePromise) {
        // A later request retries failed loading/restoration and reports the error;
        // lifecycle events must not fail because Cursor initialization failed.
        await runtimePromise.then(syncBranch).catch(() => {});
      }
    },
    stream(model, context, options) {
      // streamSimple must return synchronously, even during the first import.
      const stream = createAssistantMessageEventStream();
      const version = branchVersion;
      const timestamp = Date.now();
      void (async () => {
        try {
          options?.signal?.throwIfAborted();
          if (disposed) throw new Error("Cursor runtime has shut down");
          const runtime = await abortable(ensureRuntime(), options?.signal);
          await abortable(syncBranch(runtime), options?.signal);
          options?.signal?.throwIfAborted();
          if (disposed || version !== branchVersion) {
            throw new Error("Cursor session changed during initialization");
          }
          for await (const event of runtime.stream(model, context, options)) {
            stream.push(event);
          }
          stream.end();
        } catch (error) {
          const aborted = options?.signal?.aborted ?? false;
          const output: AssistantMessage = {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: aborted ? "aborted" : "error",
            errorMessage:
              error instanceof Error ? error.message : String(error),
            timestamp,
          };
          stream.push({
            type: "error",
            reason: aborted ? "aborted" : "error",
            error: output,
          });
          stream.end();
        }
      })();
      return stream;
    },
    async shutdown() {
      if (disposed) return;
      disposed = true;
      branchVersion++;
      if (!runtimePromise) return;
      // Wait for an in-flight import/restore, but do not import solely for cleanup.
      const runtime = await runtimePromise.catch(() => null);
      await branchWork;
      await runtime?.shutdown();
    },
  };
}
