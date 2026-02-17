export interface Writable<T> {
  write(value: T): Promise<void>;
}

export class WriteIterableClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteIterableClosedError";
  }
}

export class MapWritable<TIn, TOut> implements Writable<TIn> {
  private readonly writable: Writable<TOut>;
  private readonly map: (item: TIn) => TOut;
  private closed = false;

  constructor(writable: Writable<TOut>, map: (item: TIn) => TOut) {
    this.writable = writable;
    this.map = map;
  }

  async write(item: TIn): Promise<void> {
    if (this.closed) {
      throw new WriteIterableClosedError("WritableIterable is closed");
    }
    const mapped = this.map(item);
    await this.writable.write(mapped);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
  }
}
