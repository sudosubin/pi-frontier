import { createWritableIterable } from "@connectrpc/connect/protocol";
import type {
  AgentServerMessage,
  ConversationStateStructure,
  InteractionQuery,
  InteractionUpdate,
} from "../../__generated__/agent/v1/agent_pb";
import type {
  ExecServerControlMessage,
  ExecServerMessage,
} from "../../__generated__/agent/v1/exec_pb";
import type { KvServerMessage } from "../../__generated__/agent/v1/kv_pb";

export type InteractionMessage =
  | { case: "interactionUpdate"; value: InteractionUpdate }
  | { case: "interactionQuery"; value: InteractionQuery };

export type ExecMessage = ExecServerMessage | ExecServerControlMessage;

export interface StallDetector {
  onServerSentHeartbeat(): void;
  reset(activityType: string, messageType: string): void;
  onStreamEnded(): void;
}

export interface SplitChannels {
  interactionStream: AsyncIterable<InteractionMessage>;
  execStream: AsyncIterable<ExecMessage>;
  checkpointStream: AsyncIterable<ConversationStateStructure>;
  kvStream: AsyncIterable<KvServerMessage>;
  done: Promise<void>;
}

function getMessageTypeLabelForStallDetector(
  message: AgentServerMessage,
): string {
  const parts: (string | undefined)[] = [];
  parts.push(message.message.case);

  const msg = message.message;
  switch (msg.case) {
    case "interactionUpdate":
      parts.push(msg.value.message.case);
      break;
    case "interactionQuery":
      parts.push(msg.value.query.case);
      break;
    case "execServerMessage":
      parts.push(msg.value.message.case);
      break;
    case "execServerControlMessage":
      parts.push(msg.value.message.case);
      break;
    case "conversationCheckpointUpdate":
      break;
    case "kvServerMessage":
      parts.push(msg.value.message.case);
      break;
  }

  return parts.filter((p) => p !== undefined).join(":");
}

export function splitStream(
  stream: AsyncIterable<AgentServerMessage>,
  detector: StallDetector,
  onFirstMessage?: () => void,
): SplitChannels {
  const interactionStream = createWritableIterable<InteractionMessage>();
  const execStream = createWritableIterable<ExecMessage>();
  const checkpointStream = createWritableIterable<ConversationStateStructure>();
  const kvStream = createWritableIterable<KvServerMessage>();

  let firstMessageFired = false;

  async function run() {
    try {
      for await (const message of stream) {
        // Notify on first message (indicates connection is working)
        if (!firstMessageFired) {
          firstMessageFired = true;
          onFirstMessage?.();
        }

        if (
          message.message.case === "interactionUpdate" &&
          message.message.value.message.case === "heartbeat"
        ) {
          // Server heartbeat = server is alive and processing, reset stall timer
          detector.onServerSentHeartbeat();
          detector.reset("inbound_message", "heartbeat");
        } else {
          // Reset stall detector on any meaningful inbound message
          detector.reset(
            "inbound_message",
            getMessageTypeLabelForStallDetector(message),
          );
        }

        if (
          message.message.case === "interactionUpdate" ||
          message.message.case === "interactionQuery"
        ) {
          // Avoid unhandled rejections if the interaction stream was closed
          // (e.g., due to client-side abort/cleanup racing with server writes)
          await interactionStream
            .write(message.message as InteractionMessage)
            .catch(() => {});
        }

        if (
          message.message.case === "execServerMessage" ||
          message.message.case === "execServerControlMessage"
        ) {
          await execStream.write(message.message.value as ExecMessage);
        }

        if (message.message.case === "conversationCheckpointUpdate") {
          await checkpointStream.write(message.message.value);
        }

        if (message.message.case === "kvServerMessage") {
          await kvStream.write(message.message.value);
        }
      }

      detector.onStreamEnded();
    } finally {
      interactionStream.close();
      execStream.close();
      checkpointStream.close();
      kvStream.close();
    }
  }

  return {
    interactionStream,
    execStream,
    checkpointStream,
    kvStream,
    done: run(),
  };
}
