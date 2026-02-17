import { createWritableIterable } from "@connectrpc/connect/protocol";
import type { ControlledExecManager } from "../agent-client/exec-controller";
import { WriteIterableClosedError } from "../utils";
import {
  ExecClientControlMessage,
  ExecClientHeartbeat,
  type ExecClientMessage,
  ExecClientStreamClose,
  ExecClientThrow,
  type ExecServerControlMessage,
  type ExecServerMessage,
} from "../../__generated__/agent/v1/exec_pb";

const EXEC_HEARTBEAT_INTERVAL_MS = 3_000;

export interface SimpleExecHandler {
  handle(
    ctx: unknown,
    serverMessage: ExecServerMessage,
  ): AsyncIterable<ExecClientMessage> | undefined;
}

import type { ResourceAccessor } from "./registry-resource-accessor";

export class SimpleControlledExecManager implements ControlledExecManager {
  private readonly handlers: SimpleExecHandler[] = [];
  private readonly runningExecs: Map<string, () => void> = new Map();

  register(handler: SimpleExecHandler): void {
    this.handlers.push(handler);
  }

  handleControlMessage(serverMessage: ExecServerControlMessage): void {
    if (serverMessage.message.case === "abort") {
      const id = String(serverMessage.message.value.id);
      const execCtxCancel = this.runningExecs.get(id);
      if (execCtxCancel) {
        execCtxCancel();
      }
    }
  }

  handle(
    ctx: unknown,
    serverMessage: ExecServerMessage,
  ): AsyncIterable<ExecClientMessage | ExecClientControlMessage> {
    const execCtxCancel = () => {};
    this.runningExecs.set(String(serverMessage.id), execCtxCancel);

    for (const handler of this.handlers) {
      const result = handler.handle(ctx, serverMessage);
      if (result === undefined) {
        continue;
      }

      const resultStream = result;
      const outputStream = createWritableIterable<
        ExecClientMessage | ExecClientControlMessage
      >();

      let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
      const scheduleHeartbeat = () => {
        heartbeatTimer = setTimeout(() => {
          outputStream
            .write(
              new ExecClientControlMessage({
                message: {
                  case: "heartbeat",
                  value: new ExecClientHeartbeat({ id: serverMessage.id }),
                },
              }),
            )
            .then(scheduleHeartbeat)
            .catch(() => {});
        }, EXEC_HEARTBEAT_INTERVAL_MS);
      };
      scheduleHeartbeat();

      const run = async () => {
        try {
          for await (const message of resultStream) {
            await outputStream.write(message);
          }
          await outputStream.write(
            new ExecClientControlMessage({
              message: {
                case: "streamClose",
                value: new ExecClientStreamClose({
                  id: serverMessage.id,
                }),
              },
            }),
          );
        } catch (error) {
          if (error instanceof WriteIterableClosedError) {
            return;
          }
          await outputStream
            .write(
              new ExecClientControlMessage({
                message: {
                  case: "throw",
                  value: new ExecClientThrow({
                    id: serverMessage.id,
                    error:
                      error instanceof Error ? error.message : "Unknown error",
                    stackTrace:
                      error instanceof Error ? (error.stack ?? "") : "",
                  }),
                },
              }),
            )
            .catch(() => {});
        } finally {
          clearTimeout(heartbeatTimer);
          outputStream.close();
          this.runningExecs.delete(String(serverMessage.id));
        }
      };

      void run();
      return outputStream;
    }

    // No handler found - send error back through stream instead of throwing,
    // so the server doesn't hang waiting for a response that never comes
    this.runningExecs.delete(String(serverMessage.id));

    const errorMessage = `No handler found for server message of type ${serverMessage.message.case}`;

    return (async function* () {
      yield new ExecClientControlMessage({
        message: {
          case: "throw",
          value: new ExecClientThrow({
            id: serverMessage.id,
            error: errorMessage,
          }),
        },
      });
      yield new ExecClientControlMessage({
        message: {
          case: "streamClose",
          value: new ExecClientStreamClose({
            id: serverMessage.id,
          }),
        },
      });
    })();
  }

  static fromResources(
    resources: ResourceAccessor,
  ): SimpleControlledExecManager {
    const execManager = new SimpleControlledExecManager();
    for (const [resource, implementation] of resources.entries()) {
      resource.registerControlledImplementation(implementation, execManager);
    }
    return execManager;
  }
}
