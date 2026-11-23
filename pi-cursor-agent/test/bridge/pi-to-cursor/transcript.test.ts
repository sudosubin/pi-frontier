import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@mariozechner/pi-ai";
import { getContextTools } from "../../../src/bridge/pi-to-cursor/request-builder.js";
import {
  extractContextTools,
  extractPiSystemState,
} from "../../../src/bridge/pi-to-cursor/transcript.js";

test("extracts Pi 1.6 tools across toolsAdded and toolsRemoved system deltas", () => {
  const context = {
    messages: [
      {
        role: "system",
        content: "",
        sections: { preamble: "Hello" },
        toolsAdded: [
          { name: "read", description: "Read", parameters: { type: "object" } },
          {
            name: "codemode",
            description: "Run JS",
            parameters: {
              type: "object",
              properties: { code: { type: "string" } },
              required: ["code"],
            },
          },
          {
            name: "removed_tool",
            description: "Old",
            parameters: { type: "object" },
          },
        ],
        timestamp: 1,
      },
      {
        role: "system",
        content: "",
        toolsRemoved: [{ name: "removed_tool" }],
        toolsAdded: [
          {
            name: "subagent",
            description: "Delegate",
            parameters: { type: "object" },
          },
        ],
        timestamp: 2,
      },
      { role: "user", content: "hi", timestamp: 3 },
    ],
  } as unknown as Context;

  assert.deepEqual(
    extractContextTools(context).map((tool) => tool.name),
    ["read", "codemode", "subagent"],
  );
  assert.deepEqual(
    getContextTools(context).map((def) => def.toolName),
    ["codemode", "subagent"],
  );
});

test("replays Pi 1.6 structured sections with patches and null deletions", () => {
  const context = {
    messages: [
      {
        role: "system",
        content: "",
        sections: {
          preamble: "Custom preamble",
          rules: "<rules>\n- Rule A\n</rules>",
          mcp_servers: "<mcp_servers>\n- mcp__demo\n</mcp_servers>",
          ephemeral: "<ephemeral>\ndrop me\n</ephemeral>",
        },
        timestamp: 1,
      },
      {
        role: "system",
        content: "Appended system note",
        sections: {
          rules: "<rules>\n- Rule B\n</rules>",
          ephemeral: null,
        },
        timestamp: 2,
      },
    ],
  } as unknown as Context;

  const state = extractPiSystemState(context);
  assert.equal(state.hasStructuredSections, true);
  assert.equal(state.content, "Appended system note");
  assert.equal(state.sections["rules"], "<rules>\n- Rule B\n</rules>");
  assert.equal(state.sections["ephemeral"], undefined);
  assert.ok(state.sections["mcp_servers"]?.includes("mcp__demo"));
});

test("falls back to legacy context.systemPrompt and context.tools", () => {
  const context = {
    systemPrompt: "Legacy prompt",
    tools: [
      { name: "bash", description: "Bash", parameters: { type: "object" } },
      {
        name: "custom_ext",
        description: "Custom",
        parameters: { type: "object" },
      },
    ],
    messages: [{ role: "user", content: "hi", timestamp: 1 }],
  } as unknown as Context;

  assert.equal(extractPiSystemState(context).fullText, "Legacy prompt");
  assert.deepEqual(
    getContextTools(context).map((tool) => tool.name),
    ["custom_ext"],
  );
});
