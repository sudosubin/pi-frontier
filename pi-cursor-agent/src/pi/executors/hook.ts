import type {
  ExecuteHookArgs,
  ExecuteHookResult,
} from "../../__generated__/agent/v1/exec_pb";
import {
  ExecuteHookResponse,
  ExecuteHookResult as ExecuteHookResultClass,
  PreCompactRequestResponse,
} from "../../__generated__/agent/v1/exec_pb";
import {
  SubagentStartRequestResponse,
  SubagentStopRequestResponse,
} from "../../__generated__/agent/v1/subagents_pb";
import type { Executor } from "../../vendor/agent-exec";

export class LocalHookExecutorImpl
  implements Executor<ExecuteHookArgs, ExecuteHookResult>
{
  async execute(
    _ctx: unknown,
    args: ExecuteHookArgs,
  ): Promise<ExecuteHookResult> {
    const request = args.request;

    if (!request) {
      return new ExecuteHookResultClass({});
    }

    switch (request.request.case) {
      case "preCompact":
        return new ExecuteHookResultClass({
          response: new ExecuteHookResponse({
            response: {
              case: "preCompact",
              value: new PreCompactRequestResponse(),
            },
          }),
        });

      case "subagentStart":
        return new ExecuteHookResultClass({
          response: new ExecuteHookResponse({
            response: {
              case: "subagentStart",
              value: new SubagentStartRequestResponse(),
            },
          }),
        });

      case "subagentStop":
        return new ExecuteHookResultClass({
          response: new ExecuteHookResponse({
            response: {
              case: "subagentStop",
              value: new SubagentStopRequestResponse(),
            },
          }),
        });

      default:
        return new ExecuteHookResultClass({});
    }
  }
}
