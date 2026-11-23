import type { CursorRule } from "../../__generated__/agent/v1/cursor_rules_pb";
import type { McpToolDefinition } from "../../__generated__/agent/v1/mcp_pb";
import type { PiSystemState } from "../pi-to-cursor/transcript";
import { parsePiSystemPrompt, parsePiSystemState } from "./parser";
import { buildCursorRules } from "./rules-builder";

export interface PreparedPiContext {
  rules: CursorRule[];
  cleanedPrompt: string;
}

export async function preparePiContext(
  input: string | PiSystemState,
  advertisedTools: McpToolDefinition[] = [],
): Promise<PreparedPiContext> {
  const parsed =
    typeof input === "string"
      ? parsePiSystemPrompt(input, advertisedTools)
      : parsePiSystemState(input, advertisedTools);
  const rules = await buildCursorRules(parsed);
  return { rules, cleanedPrompt: parsed.cleanedPrompt };
}
