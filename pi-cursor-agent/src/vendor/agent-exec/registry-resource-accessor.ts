import type { SimpleControlledExecManager } from "./simple-controlled-exec-manager";

export interface ResourceLike {
  readonly symbol: symbol;
  registerControlledImplementation(
    implementation: unknown,
    controlledExecManager: SimpleControlledExecManager,
  ): void;
}

export interface ResourceAccessor {
  entries(): Array<[ResourceLike, unknown]>;
}

class ResourceDescriptor {
  constructor(
    public readonly resource: ResourceLike,
    public readonly value: unknown,
  ) {}
}

export class RegistryResourceAccessor implements ResourceAccessor {
  private readonly resources = new Map<symbol, ResourceDescriptor>();

  register(resource: ResourceLike, value: unknown): void {
    this.resources.set(
      resource.symbol,
      new ResourceDescriptor(resource, value),
    );
  }

  get(resource: ResourceLike): unknown | undefined {
    return this.resources.get(resource.symbol)?.value;
  }

  entries(): Array<[ResourceLike, unknown]> {
    return Array.from(this.resources.values()).map((desc) => [
      desc.resource,
      desc.value,
    ]);
  }
}
