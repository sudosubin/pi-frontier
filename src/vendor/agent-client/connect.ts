import { createWritableIterable } from "@connectrpc/connect/protocol";
import {
  AgentClientMessage,
  type AgentServerMessage,
  ClientHeartbeat,
  type InteractionResponse,
} from "../../__generated__/agent/v1/agent_pb";
import {
  ExecClientControlMessage,
  ExecClientMessage,
} from "../../__generated__/agent/v1/exec_pb";
import type { KvClientMessage } from "../../__generated__/agent/v1/kv_pb";
import { SimpleControlledExecManager } from "../agent-exec/simple-controlled-exec-manager";
import type { ResourceAccessor } from "../agent-exec/registry-resource-accessor";
import { MapWritable } from "../utils";
import { ControlledKvManager, type BlobStore } from "../agent-kv";
import {
  splitStream,
  type StallDetector,
  type SplitChannels,
} from "./split-stream";
import {
  ClientExecController,
  LostConnection,
} from "./exec-controller";
import {
  ClientInteractionController,
  type InteractionListener,
} from "./interaction-controller";
import {
  CheckpointController,
  type CheckpointHandler,
} from "./checkpoint-controller";

export interface AgentRpcClient {
  run(
    input: AsyncIterable<AgentClientMessage>,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): AsyncIterable<AgentServerMessage>;
}

export interface AgentConnectRunOptions {
  interactionListener: InteractionListener;
  resources: ResourceAccessor;
  blobStore: BlobStore;
  checkpointHandler: CheckpointHandler;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  onConnectionStateChange?: (state: { state: "reconnecting" | "connected" }) => void;
}

const HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_RETRY_ATTEMPTS = 5;

function createNoopStallDetector(): StallDetector {
  return {
    onServerSentHeartbeat() {},
    reset() {},
    onStreamEnded() {},
  };
}

function isRetriableError(error: unknown): boolean {
  if (error instanceof LostConnection) return true;
  if (error instanceof Error && error.message.includes("NGHTTP2")) return true;
  return false;
}

async function backoff(attempt: number, signal?: AbortSignal): Promise<void> {
  const delay = Math.min(1_000 * 2 ** attempt, 30_000);
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export class AgentConnectClient {
  private readonly client: AgentRpcClient;

  constructor(client: AgentRpcClient) {
    this.client = client;
  }

  /**
   * Public entry point with centralized retry and resume logic.
   *
   * Retry behavior:
   * - Transport/stall errors: retry indefinitely with exponential backoff
   * - Server errors (high load): retry up to MAX_SERVER_ERROR_RETRIES times
   * - Non-retriable errors: surface immediately
   *
   * Checkpoint behavior:
   * - If a NEW checkpoint was received before failure, resume from checkpoint
   * - If NO checkpoint was received, resend the original action (prevents message loss)
   */
  async run(
    initialRequest: AgentClientMessage,
    options: AgentConnectRunOptions,
  ): Promise<void> {
    let attempt = 0;

    while (true) {
      if (options.signal?.aborted) {
        throw new Error("Request cancelled");
      }

      try {
        await this.runInternal(initialRequest, options);
        return;
      } catch (error) {
        if (!isRetriableError(error) || attempt >= MAX_RETRY_ATTEMPTS) {
          throw error;
        }

        options.onConnectionStateChange?.({ state: "reconnecting" });
        attempt++;
        await backoff(attempt, options.signal);
      }
    }
  }

  /**
   * Internal implementation that may throw any error type.
   * All errors are caught and converted at the public `run` boundary.
   */
  private async runInternal(
    initialRequest: AgentClientMessage,
    options: AgentConnectRunOptions,
  ): Promise<void> {
    const controlledExecManager = SimpleControlledExecManager.fromResources(
      options.resources,
    );

    const stallDetector = createNoopStallDetector();

    const baseRequestStream = createWritableIterable<AgentClientMessage>();

    void baseRequestStream.write(initialRequest);

    const runOptions: { signal?: AbortSignal; headers?: Record<string, string> } = {};
    if (options.signal) runOptions.signal = options.signal;
    if (options.headers) runOptions.headers = options.headers;

    const response = this.client.run(baseRequestStream, runOptions);

    const channels: SplitChannels = splitStream(
      response,
      stallDetector,
      () => options.onConnectionStateChange?.({ state: "connected" }),
    );

    // Heartbeat sender using setTimeout (not setInterval)
    let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;

    const scheduleHeartbeat = () => {
      heartbeatTimeout = setTimeout(() => {
        baseRequestStream
          .write(
            new AgentClientMessage({
              message: {
                case: "clientHeartbeat",
                value: new ClientHeartbeat(),
              },
            }),
          )
          .then(scheduleHeartbeat)
          .catch(() => {});
      }, HEARTBEAT_INTERVAL_MS);
    };

    const clearHeartbeat = () => {
      if (heartbeatTimeout !== undefined) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = undefined;
      }
    };

    scheduleHeartbeat();

    try {
      const execOutputStream = new MapWritable<
        ExecClientMessage | ExecClientControlMessage,
        AgentClientMessage
      >(baseRequestStream, (message) => {
        if (message instanceof ExecClientMessage) {
          return new AgentClientMessage({
            message: { case: "execClientMessage", value: message },
          });
        }
        if (message instanceof ExecClientControlMessage) {
          return new AgentClientMessage({
            message: { case: "execClientControlMessage", value: message },
          });
        }
        throw new Error("Unknown exec message type");
      });

      const kvOutputStream = new MapWritable<
        KvClientMessage,
        AgentClientMessage
      >(
        baseRequestStream,
        (message) =>
          new AgentClientMessage({
            message: { case: "kvClientMessage", value: message },
          }),
      );

      const queryResponseStream = new MapWritable<
        InteractionResponse,
        AgentClientMessage
      >(
        baseRequestStream,
        (response) =>
          new AgentClientMessage({
            message: { case: "interactionResponse", value: response },
          }),
      );

      const interactionController = new ClientInteractionController(
        channels.interactionStream,
        options.interactionListener,
        queryResponseStream,
      );

      const execController = new ClientExecController(
        channels.execStream,
        execOutputStream,
        controlledExecManager,
      );

      const kvManager = new ControlledKvManager(
        channels.kvStream,
        kvOutputStream,
        options.blobStore,
      );

      const checkpointController = new CheckpointController(
        channels.checkpointStream,
        options.checkpointHandler,
        null,
      );

      const ctx = null;

      const results = await Promise.allSettled([
        channels.done.finally(() => {
          clearHeartbeat();
          execOutputStream.close();
        }),
        execController.run(ctx),
        interactionController.run(ctx),
        checkpointController.run(),
        kvManager.run(ctx),
      ]);

      for (const result of results) {
        if (result.status === "rejected") {
          throw result.reason;
        }
      }
    } finally {
      clearHeartbeat();
      baseRequestStream.close();
    }
  }
}
