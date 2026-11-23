import assert from "node:assert/strict";
import test from "node:test";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import {
  buildMcpResultFromToolResult,
  resolveMcpToolName,
} from "../../../src/bridge/cursor-to-pi/executors/mcp.js";
import { buildReadResultFromToolResult } from "../../../src/bridge/cursor-to-pi/executors/read.js";
import { buildScopedShellCommand } from "../../../src/bridge/cursor-to-pi/executors/shell.js";

test("resolveMcpToolName handles toolName and provider-prefixed name", () => {
  assert.equal(
    resolveMcpToolName({
      name: "pi-agent-codemode",
      toolName: "codemode",
      providerIdentifier: "pi-agent",
    }),
    "codemode",
  );
  assert.equal(
    resolveMcpToolName({
      name: "pi-agent-codemode",
      toolName: "",
      providerIdentifier: "pi-agent",
    }),
    "codemode",
  );
});

test("buildMcpResultFromToolResult preserves text and image blocks", () => {
  const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
  const result: ToolResultMessage = {
    role: "toolResult",
    toolCallId: "call_1",
    toolName: "codemode",
    content: [
      { type: "text", text: "Generated output" },
      { type: "image", data: pngBase64, mimeType: "image/png" },
    ],
    isError: false,
    timestamp: 1,
  };

  const mcpRes = buildMcpResultFromToolResult(result);
  assert.equal(mcpRes.result.case, "success");
  assert.equal(mcpRes.result.value.content.length, 2);
  assert.equal(mcpRes.result.value.content[0]?.content.case, "text");
  assert.equal(mcpRes.result.value.content[1]?.content.case, "image");
  if (mcpRes.result.value.content[1]?.content.case === "image") {
    assert.equal(
      mcpRes.result.value.content[1].content.value.mimeType,
      "image/png",
    );
    assert.deepEqual(
      Array.from(mcpRes.result.value.content[1].content.value.data),
      [0x89, 0x50, 0x4e, 0x47],
    );
  }
});

test("buildReadResultFromToolResult returns binary data for image reads", () => {
  const pngBase64 = Buffer.from([1, 2, 3, 4]).toString("base64");
  const res = buildReadResultFromToolResult("/tmp/a.png", {
    role: "toolResult",
    toolCallId: "r1",
    toolName: "read",
    content: [
      { type: "text", text: "Read image file [image/png]" },
      { type: "image", data: pngBase64, mimeType: "image/png" },
    ],
    isError: false,
    timestamp: 1,
  });

  assert.equal(res.result.case, "success");
  assert.equal(res.result.value.output.case, "data");
  if (res.result.value.output.case === "data") {
    assert.deepEqual(Array.from(res.result.value.output.value), [1, 2, 3, 4]);
  }
});

test("buildScopedShellCommand scopes workingDirectory when different from cwd", () => {
  assert.equal(
    buildScopedShellCommand("ls", "/home/user/repo", "/home/user/repo"),
    "ls",
  );
  assert.equal(
    buildScopedShellCommand("ls || true", "/tmp/sub dir", "/home/user/repo"),
    "cd '/tmp/sub dir' && {\nls || true\n}",
  );
});
