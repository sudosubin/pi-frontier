import { setTimeout } from "node:timers/promises";
import {
  rejectPendingExceptSession,
  rejectPendingForSession,
} from "../bridge/cursor-to-pi/tool-bridge";
import { retainOnlyAgentStore } from "../lib/agent-store";
import { evictAgentStore } from "./agent-store";
import {
  deleteLiveSession,
  getLiveSession,
  retainOnlyLiveSession,
} from "./agent-stream-hook";

const TERMINATION_WAIT_MS = 2_000;

export async function waitForCursorRun(run: Promise<void>): Promise<void> {
  const timer = new AbortController();
  try {
    await Promise.race([
      run.catch(() => {}),
      setTimeout(TERMINATION_WAIT_MS, undefined, { signal: timer.signal }),
    ]);
  } finally {
    timer.abort();
  }
}

export async function terminateSession(
  sessionId: string,
  reason: string,
): Promise<void> {
  const live = getLiveSession(sessionId);

  // Detach before abort wakes the stream consumer. Its late cleanup must not
  // evict a replacement run or append to the newly selected Pi branch.
  deleteLiveSession(sessionId);
  if (live) {
    live.abort(reason);
    live.channel.fail(new Error(reason));
  }

  rejectPendingForSession(sessionId, reason);

  if (live) {
    await waitForCursorRun(live.cursorRunPromise);
  }

  let flushed = false;
  if (live) {
    try {
      await live.flushSessionState(false);
      flushed = true;
    } catch {}
  }

  deleteLiveSession(sessionId);
  await evictAgentStore(sessionId, { persist: !flushed }).catch(() => {});
}

export function retainOnlyActiveSessionMemory(
  sessionId: string | null,
  reason = "Session ended",
): void {
  rejectPendingExceptSession(sessionId, reason);
  retainOnlyLiveSession(sessionId);
  retainOnlyAgentStore(sessionId);
}
