import type { ConversationStateStructure } from "../../__generated__/agent/v1/agent_pb";

export interface CheckpointHandler {
  handleCheckpoint(
    ctx: unknown,
    checkpoint: ConversationStateStructure,
  ): Promise<void>;
  getLatestCheckpoint?: () => ConversationStateStructure | undefined;
}

export class CheckpointController {
  private readonly checkpointStream: AsyncIterable<ConversationStateStructure>;
  private readonly checkpointHandler: CheckpointHandler;
  private readonly ctx: unknown;

  constructor(
    checkpointStream: AsyncIterable<ConversationStateStructure>,
    checkpointHandler: CheckpointHandler,
    ctx: unknown,
  ) {
    this.checkpointStream = checkpointStream;
    this.checkpointHandler = checkpointHandler;
    this.ctx = ctx;
  }

  async run(): Promise<void> {
    const ctx = this.ctx;
    const promises: Promise<void>[] = [];
    for await (const checkpoint of this.checkpointStream) {
      promises.push(this.checkpointHandler.handleCheckpoint(ctx, checkpoint));
    }
    await Promise.all(promises);
  }
}
