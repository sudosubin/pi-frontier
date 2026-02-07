import type { Executor } from "../../vendor/agent-exec";

import type { BackgroundShellSpawnArgs } from "../../__generated__/agent/v1/background_shell_exec_pb";
import { BackgroundShellSpawnResult } from "../../__generated__/agent/v1/background_shell_exec_pb";
import type { WriteShellStdinArgs } from "../../__generated__/agent/v1/write_shell_stdin_tool_pb";
import {
  WriteShellStdinError,
  WriteShellStdinResult,
} from "../../__generated__/agent/v1/write_shell_stdin_tool_pb";
import type { FetchArgs } from "../../__generated__/agent/v1/fetch_tool_pb";
import {
  FetchError,
  FetchResult,
} from "../../__generated__/agent/v1/fetch_tool_pb";
import type { DiagnosticsArgs } from "../../__generated__/agent/v1/diagnostics_exec_pb";
import {
  DiagnosticsResult,
  DiagnosticsSuccess,
} from "../../__generated__/agent/v1/diagnostics_exec_pb";
import type { McpArgs } from "../../__generated__/agent/v1/mcp_tool_pb";
import { McpError, McpResult } from "../../__generated__/agent/v1/mcp_tool_pb";
import type {
  ListMcpResourcesExecArgs,
  ReadMcpResourceExecArgs,
} from "../../__generated__/agent/v1/mcp_resource_tool_pb";
import {
  ListMcpResourcesExecResult,
  ListMcpResourcesRejected,
  ReadMcpResourceExecResult,
  ReadMcpResourceRejected,
} from "../../__generated__/agent/v1/mcp_resource_tool_pb";
import type { RecordScreenArgs } from "../../__generated__/agent/v1/record_screen_tool_pb";
import {
  RecordScreenFailure,
  RecordScreenResult,
} from "../../__generated__/agent/v1/record_screen_tool_pb";
import type { ComputerUseArgs } from "../../__generated__/agent/v1/computer_use_tool_pb";
import {
  ComputerUseError,
  ComputerUseResult,
} from "../../__generated__/agent/v1/computer_use_tool_pb";
import { ShellRejected } from "../../__generated__/agent/v1/shell_exec_pb";

export class StubBackgroundShellExecutor implements Executor<
  BackgroundShellSpawnArgs,
  BackgroundShellSpawnResult
> {
  async execute(_ctx: unknown, args: BackgroundShellSpawnArgs) {
    return new BackgroundShellSpawnResult({
      result: {
        case: "rejected",
        value: new ShellRejected({
          command: args.command,
          workingDirectory: args.workingDirectory,
          reason: "Not implemented",
          isReadonly: false,
        }),
      },
    });
  }
}

export class StubWriteShellStdinExecutor implements Executor<
  WriteShellStdinArgs,
  WriteShellStdinResult
> {
  async execute() {
    return new WriteShellStdinResult({
      result: {
        case: "error",
        value: new WriteShellStdinError({ error: "Not implemented" }),
      },
    });
  }
}

export class StubFetchExecutor implements Executor<FetchArgs, FetchResult> {
  async execute(_ctx: unknown, args: FetchArgs) {
    return new FetchResult({
      result: {
        case: "error",
        value: new FetchError({ url: args.url, error: "Not implemented" }),
      },
    });
  }
}

export class StubDiagnosticsExecutor implements Executor<
  DiagnosticsArgs,
  DiagnosticsResult
> {
  async execute() {
    return new DiagnosticsResult({
      result: {
        case: "success",
        value: new DiagnosticsSuccess({
          diagnostics: [],
          totalDiagnostics: 0,
        }),
      },
    });
  }
}

export class StubMcpExecutor implements Executor<McpArgs, McpResult> {
  async execute() {
    return new McpResult({
      result: {
        case: "error",
        value: new McpError({ error: "MCP not supported" }),
      },
    });
  }
}

export class StubListMcpResourcesExecutor implements Executor<
  ListMcpResourcesExecArgs,
  ListMcpResourcesExecResult
> {
  async execute() {
    return new ListMcpResourcesExecResult({
      result: {
        case: "rejected",
        value: new ListMcpResourcesRejected({ reason: "MCP not supported" }),
      },
    });
  }
}

export class StubReadMcpResourceExecutor implements Executor<
  ReadMcpResourceExecArgs,
  ReadMcpResourceExecResult
> {
  async execute(_ctx: unknown, args: ReadMcpResourceExecArgs) {
    return new ReadMcpResourceExecResult({
      result: {
        case: "rejected",
        value: new ReadMcpResourceRejected({
          uri: args.uri,
          reason: "MCP not supported",
        }),
      },
    });
  }
}

export class StubRecordScreenExecutor implements Executor<
  RecordScreenArgs,
  RecordScreenResult
> {
  async execute() {
    return new RecordScreenResult({
      result: {
        case: "failure",
        value: new RecordScreenFailure({ error: "Not implemented" }),
      },
    });
  }
}

export class StubComputerUseExecutor implements Executor<
  ComputerUseArgs,
  ComputerUseResult
> {
  async execute() {
    return new ComputerUseResult({
      result: {
        case: "error",
        value: new ComputerUseError({ error: "Not implemented" }),
      },
    });
  }
}
