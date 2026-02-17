import { ConnectError, Code } from "@connectrpc/connect";
import {
  ExecServerControlMessage,
  type ExecServerMessage,
  type ExecClientMessage,
  type ExecClientControlMessage,
} from "../../__generated__/agent/v1/exec_pb";
import { WriteIterableClosedError } from "../utils";

export interface Writable<T> {
  write(value: T): Promise<void>;
}

export interface ControlledExecManager {
  handle(
    ctx: unknown,
    message: ExecServerMessage,
  ): AsyncIterable<ExecClientMessage | ExecClientControlMessage>;
  handleControlMessage(message: ExecServerControlMessage): void;
}

export class LostConnection extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LostConnection";
  }
}

export class ClientExecController {
  private readonly serverStream: AsyncIterable<
    ExecServerMessage | ExecServerControlMessage
  >;
  private readonly clientStream: Writable<
    ExecClientMessage | ExecClientControlMessage
  >;
  private readonly controlledExecManager: ControlledExecManager;

  constructor(
    serverStream: AsyncIterable<ExecServerMessage | ExecServerControlMessage>,
    clientStream: Writable<ExecClientMessage | ExecClientControlMessage>,
    controlledExecManager: ControlledExecManager,
  ) {
    this.serverStream = serverStream;
    this.clientStream = clientStream;
    this.controlledExecManager = controlledExecManager;
  }

  async run(ctx: unknown): Promise<void> {
    const pendingPromises: Promise<void>[] = [];
    try {
      for await (const message of this.serverStream) {
        if (message instanceof ExecServerControlMessage) {
          this.controlledExecManager.handleControlMessage(message);
          continue;
        }

        const serverMessage = message as ExecServerMessage;

        const promise = (async () => {
          const stream = this.controlledExecManager.handle(ctx, serverMessage);
          for await (const result of stream) {
            await this.clientStream.write(result);
          }
        })();

        pendingPromises.push(promise);
      }

      await Promise.all(pendingPromises);
    } catch (error) {
      if (
        error instanceof ConnectError &&
        error.rawMessage === "protocol error: missing EndStreamResponse"
      ) {
        throw new LostConnection(error.message);
      } else if (error instanceof ConnectError && error.code === Code.Aborted) {
        const cause = error.cause;
        if (
          cause instanceof Error &&
          "code" in cause &&
          typeof (cause as any).code === "string" &&
          ((cause as any).code as string).includes("ERR_STREAM_WRITE_AFTER_END")
        ) {
          throw new LostConnection(error.message);
        }
      } else if (error instanceof WriteIterableClosedError) {
        throw new LostConnection(error.message);
      } else if (
        error instanceof ConnectError &&
        error.code === Code.Internal
      ) {
        const cause = error.cause;
        if (
          cause instanceof Error &&
          cause.message.includes("NGHTTP2_PROTOCOL_ERROR")
        ) {
          throw new LostConnection(error.message);
        }
      }
    }
  }
}
