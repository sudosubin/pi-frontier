import type { McpToolDefinition } from "../../__generated__/agent/v1/mcp_pb";
import {
  RegistryResourceAccessor,
  readResource,
  writeResource,
  deleteResource,
  shellResource,
  shellStreamResource,
  grepResource,
  lsResource,
  diagnosticsResource,
  requestContextResource,
  mcpResource,
  listMcpResourcesResource,
  readMcpResourceResource,
  backgroundShellResource,
  writeShellStdinResource,
  fetchResource,
  recordScreenResource,
  computerUseResource,
  hookExecutorResource,
} from "../../vendor/agent-exec";

import type { PiToolContext } from "./types";
import { LocalReadExecutor } from "../executors/read";
import { LocalWriteExecutor } from "../executors/write";
import { LocalDeleteExecutor } from "../executors/delete";
import { LocalShellExecutor } from "../executors/shell";
import { LocalShellStreamExecutor } from "../executors/shell-stream";
import { LocalGrepExecutor } from "../executors/grep";
import { LocalLsExecutor } from "../executors/ls";
import { LocalRequestContextExecutor } from "../executors/request-context";
import { LocalHookExecutorImpl } from "../executors/hook";
import {
  StubBackgroundShellExecutor,
  StubWriteShellStdinExecutor,
  StubFetchExecutor,
  StubDiagnosticsExecutor,
  StubMcpExecutor,
  StubListMcpResourcesExecutor,
  StubReadMcpResourceExecutor,
  StubRecordScreenExecutor,
  StubComputerUseExecutor,
} from "../executors/stubs";

interface LocalResourceProviderOptions {
  ctx: PiToolContext;
  requestContextTools?: McpToolDefinition[];
  workspacePaths?: string[];
}

export class LocalResourceProvider extends RegistryResourceAccessor {
  constructor(options: LocalResourceProviderOptions) {
    super();
    const { ctx, requestContextTools = [], workspacePaths } = options;
    const resolvedWorkspacePaths = workspacePaths ?? [ctx.cwd];

    // hook-executor
    this.register(hookExecutorResource, new LocalHookExecutorImpl());

    // request-context
    this.register(
      requestContextResource,
      new LocalRequestContextExecutor(
        requestContextTools,
        resolvedWorkspacePaths,
      ),
    );

    // read, write, delete
    this.register(readResource, new LocalReadExecutor(ctx));
    this.register(writeResource, new LocalWriteExecutor(ctx));
    this.register(deleteResource, new LocalDeleteExecutor(ctx));

    // shell (unary + stream)
    const shellExecutor = new LocalShellExecutor(ctx);
    this.register(shellResource, shellExecutor);
    this.register(
      shellStreamResource,
      new LocalShellStreamExecutor(ctx, shellExecutor),
    );

    // grep, ls
    this.register(grepResource, new LocalGrepExecutor(ctx));
    this.register(lsResource, new LocalLsExecutor(ctx));

    // stubs (not implemented)
    this.register(backgroundShellResource, new StubBackgroundShellExecutor());
    this.register(writeShellStdinResource, new StubWriteShellStdinExecutor());
    this.register(fetchResource, new StubFetchExecutor());
    this.register(diagnosticsResource, new StubDiagnosticsExecutor());
    this.register(mcpResource, new StubMcpExecutor());
    this.register(listMcpResourcesResource, new StubListMcpResourcesExecutor());
    this.register(readMcpResourceResource, new StubReadMcpResourceExecutor());
    this.register(recordScreenResource, new StubRecordScreenExecutor());
    this.register(computerUseResource, new StubComputerUseExecutor());
  }
}
