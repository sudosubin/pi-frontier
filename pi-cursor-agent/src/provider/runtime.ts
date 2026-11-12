import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { restoreAgentStoreFromBranch } from "./agent-store";
import type { CursorRuntime } from "./lazy-runtime";
import {
  retainOnlyActiveSessionMemory,
  terminateSession,
} from "./session-lifecycle";
import type { CursorStateStore } from "./state";
import { streamCursorAgent } from "./stream";

// This module is the heavy boundary: nothing here is needed to list models.
export function createCursorRuntime(
  pi: ExtensionAPI,
  getCtx: () => ExtensionContext | null,
  state: CursorStateStore,
): CursorRuntime {
  let currentSessionId: string | null = null;
  let generation = 0;

  return {
    async refreshBranchState(ctx) {
      generation++;
      const sessionId = ctx.sessionManager.getSessionId();
      const previousSessionId = currentSessionId;
      currentSessionId = sessionId;
      if (previousSessionId) {
        await terminateSession(previousSessionId, "Session ended");
      }
      state.resetFromContext(ctx);
      // Restoration failures must reach the request and remain retryable in the
      // lazy facade; never silently run with another branch's checkpoint.
      await restoreAgentStoreFromBranch(
        sessionId,
        ctx.sessionManager.getBranch(),
      );
      retainOnlyActiveSessionMemory(sessionId);
    },
    stream: (model, context, options) => {
      const requestGeneration = generation;
      return streamCursorAgent(
        pi,
        getCtx,
        state,
        model,
        context,
        options,
        () => requestGeneration === generation,
      );
    },
    async shutdown() {
      generation++;
      if (currentSessionId) {
        await terminateSession(currentSessionId, "Session ended");
        currentSessionId = null;
      }
    },
  };
}
