import {
  ExecClientMessage,
  type ExecServerMessage,
} from "../../__generated__/agent/v1/exec_pb";

export function createServerDeserializer<TArgs>(argsCase: string) {
  return (msg: ExecServerMessage): { id: number; args: TArgs } | undefined => {
    if (msg.message.case !== argsCase) return undefined;
    return { id: msg.id, args: msg.message.value as TArgs };
  };
}

export function createClientSerializer<TResult>(resultCase: string) {
  return (id: number, result: TResult): ExecClientMessage => {
    return new ExecClientMessage({
      id,
      message: {
        case: resultCase,
        value: result,
      } as unknown as ExecClientMessage["message"],
    });
  };
}
