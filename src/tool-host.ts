import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { SimpleControlledExecManager } from "./vendor/agent-exec";
import type { McpToolDefinition } from "./__generated__/agent/v1/mcp_pb";
import {
  LocalResourceProvider,
  type PiToolContext,
  type ToolExecEvent,
} from "./pi/local-resource-provider";

export type {
  ToolExecEvent,
  ToolExecStartEvent,
  ToolExecEndEvent,
} from "./pi/local-resource-provider";

export interface ToolHostOptions {
  cwd: string;
  signal?: AbortSignal;
  getActiveTools: () => Set<string>;
  getCtx: () => ExtensionContext | null;
  requestContextTools?: McpToolDefinition[];
  onToolExec?: (event: ToolExecEvent) => void;
}

export class ToolHost {
  readonly execManager: SimpleControlledExecManager;

  constructor(options: ToolHostOptions) {
    const ctx: PiToolContext = {
      cwd: options.cwd,
      ...(options.signal ? { signal: options.signal } : {}),
      getActiveTools: options.getActiveTools,
      getCtx: options.getCtx,
      onToolExec: (event) => options.onToolExec?.(event),
    };

    const provider = new LocalResourceProvider({
      ctx,
      requestContextTools: options.requestContextTools ?? [],
    });

    this.execManager = SimpleControlledExecManager.fromResources(provider);
  }
}
