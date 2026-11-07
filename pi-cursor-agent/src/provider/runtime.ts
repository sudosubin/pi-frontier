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

  return {
    async refreshBranchState(ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const previousSessionId = currentSessionId;
      currentSessionId = sessionId;
      if (previousSessionId && previousSessionId !== sessionId) {
        await terminateSession(previousSessionId, "Session ended");
      }
      state.resetFromContext(ctx);
      try {
        await restoreAgentStoreFromBranch(
          sessionId,
          ctx.sessionManager.getBranch(),
        );
      } catch {}
      retainOnlyActiveSessionMemory(sessionId);
    },
    stream: (model, context, options) =>
      streamCursorAgent(pi, getCtx, state, model, context, options),
    async shutdown() {
      if (currentSessionId) {
        await terminateSession(currentSessionId, "Session ended");
        currentSessionId = null;
      }
    },
  };
}
