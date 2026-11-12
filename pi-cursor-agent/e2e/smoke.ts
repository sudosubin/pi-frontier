// Opt-in only. Uses real Pi SDK, extension, tools, OAuth and Cursor transport.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type {
  AgentSessionEvent,
  ExtensionFactory,
} from "@mariozechner/pi-coding-agent";

if (process.env["PI_CURSOR_E2E"] !== "1") {
  throw new Error(
    "Set PI_CURSOR_E2E=1 to allow real Cursor requests and tool execution",
  );
}
const directory = process.env["PI_CODING_AGENT_DIR"];
assert.ok(
  directory && path.isAbsolute(directory),
  "Use an explicit, dedicated absolute PI_CODING_AGENT_DIR",
);
assert.equal(
  process.env["CURSOR_ACCESS_TOKEN"],
  undefined,
  "Unset CURSOR_ACCESS_TOKEN; use isolated OAuth credentials",
);
const mode = process.argv[2] ?? "conversation";
assert.ok(
  [
    "login",
    "conversation",
    "resume",
    "refresh-cold",
    "refresh-warm",
    "check",
  ].includes(mode),
  "Unknown smoke mode",
);
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const marker = path.join(directory, ".cursor-e2e-owned");
if (!fs.existsSync(marker)) {
  assert.equal(
    fs.readdirSync(directory).length,
    0,
    "Refusing to use an existing non-test agent directory",
  );
  fs.writeFileSync(marker, "Dedicated Cursor E2E directory\n", { mode: 0o600 });
}
const cwd = path.join(directory, "work");
fs.mkdirSync(cwd, { recursive: true });
// Resolve paths before changing cwd. Prevent discovery of the caller's projects.
process.chdir(cwd);
const {
  AuthStorage,
  ModelRegistry,
  DefaultResourceLoader,
  SettingsManager,
  SessionManager,
  createAgentSession,
  createReadTool,
  createWriteTool,
} = await import("@mariozechner/pi-coding-agent");
const { default: extension } = await import("../src/index.js");
const auth = new AuthStorage(path.join(directory, "auth.json"));
const registry = new ModelRegistry(auth, path.join(directory, "models.json"));
const settings = SettingsManager.inMemory({
  retry: { enabled: false },
  compaction: { enabled: false },
});
let refreshes = 0;
let refreshedAccess: string | undefined;
const refreshedKeyMatches: boolean[] = [];
const factory: ExtensionFactory = (pi) =>
  extension({
    ...pi,
    registerProvider(name, config) {
      const originalStream = config.streamSimple;
      const oauth = config.oauth;
      assert.ok(originalStream && oauth);
      pi.registerProvider(name, {
        ...config,
        streamSimple: (model, context, options) => {
          if (refreshedAccess)
            refreshedKeyMatches.push(options?.apiKey === refreshedAccess);
          return originalStream(model, context, options);
        },
        oauth: {
          ...oauth,
          async refreshToken(credentials) {
            const result = await oauth.refreshToken(credentials);
            refreshes++;
            refreshedAccess = result.access;
            return result;
          },
        },
      });
    },
  });
const loader = new DefaultResourceLoader({
  cwd,
  agentDir: directory,
  settingsManager: settings,
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  extensionFactories: [factory],
  agentsFilesOverride: () => ({ agentsFiles: [] }),
  systemPromptOverride: () =>
    "Follow the user's instructions exactly. Use tools when requested. Work only in the current directory.",
});
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, [], "Extension load failed");

function expireCredential() {
  const cred = auth.get("cursor-agent");
  assert.ok(
    cred?.type === "oauth" && cred.refresh,
    "A real refresh credential is required",
  );
  auth.set("cursor-agent", { ...cred, expires: 0 });
}
if (mode === "refresh-cold") expireCredential();
const resumeFile = path.join(directory, "resume.json");
const saved =
  mode === "resume"
    ? (JSON.parse(fs.readFileSync(resumeFile, "utf8")) as {
        file: string;
        nonce: string;
      })
    : undefined;
const manager = saved
  ? SessionManager.open(saved.file)
  : SessionManager.create(cwd, path.join(directory, "sessions"));
const { session } = await createAgentSession({
  cwd,
  agentDir: directory,
  authStorage: auth,
  modelRegistry: registry,
  resourceLoader: loader,
  sessionManager: manager,
  settingsManager: settings,
  tools: [createReadTool(cwd), createWriteTool(cwd)],
});
const events: AgentSessionEvent[] = [];
const evidence: Record<string, unknown> = {
  mode,
  node: process.version,
  checks: [],
};
const checks: string[] = [];
let cancelAt: "text" | "tool" | undefined;
let cancelled = false;
let readLiveSession: ((id: string) => object | undefined) | undefined;
const toolSessions: Array<object | undefined> = [];
let abortPromise: Promise<void> | undefined;
let abortDeadline: ReturnType<typeof setTimeout> | undefined;
session.subscribe((event) => {
  events.push(structuredClone(event));
  if (event.type === "tool_execution_start")
    toolSessions.push(readLiveSession?.(manager.getSessionId()));
  if (
    !cancelled &&
    ((cancelAt === "text" &&
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta") ||
      (cancelAt === "tool" && event.type === "tool_execution_start"))
  ) {
    cancelled = true;
    abortDeadline = setTimeout(() => {
      console.error("FAIL: cancellation timeout");
      process.exit(1);
    }, 10_000);
    abortPromise = session.abort();
  }
});
await session.bindExtensions({
  onError: () => {
    throw new Error("Extension lifecycle error");
  },
});

async function prompt(text: string, cancel?: "text" | "tool") {
  events.length = 0;
  toolSessions.length = 0;
  cancelAt = cancel;
  cancelled = false;
  abortPromise = undefined;
  const hardStop = setTimeout(() => {
    console.error("FAIL: request timeout");
    process.exit(1);
  }, 120_000);
  const first = session.messages.length;
  try {
    await session.prompt(text);
    if (abortPromise) await abortPromise;
    const replies = session.messages
      .slice(first)
      .filter((m): m is AssistantMessage => m.role === "assistant");
    const last = replies.at(-1);
    assert.ok(last, "No assistant result");
    if (cancel) {
      assert.equal(
        cancelled,
        true,
        `INCONCLUSIVE: no ${cancel} cancellation point`,
      );
      assert.ok(
        replies.some((m) => m.stopReason === "aborted") ||
          (cancel === "tool" &&
            events.some((e) => e.type === "tool_execution_end")),
        "Cancellation did not settle",
      );
    } else {
      assert.ok(
        replies.every(
          (m) => m.stopReason !== "error" && m.stopReason !== "aborted",
        ),
        "Cursor request failed",
      );
      assert.equal(last.stopReason, "stop");
      assert.ok(
        events.some(
          (e) =>
            e.type === "message_update" &&
            e.assistantMessageEvent.type === "text_delta",
        ),
        "No streamed text",
      );
      for (const reply of replies) {
        const deltas = events.filter(
          (e) =>
            e.type === "message_update" &&
            e.assistantMessageEvent.type === "text_delta" &&
            e.assistantMessageEvent.partial.timestamp === reply.timestamp,
        );
        const text = deltas
          .map((e) =>
            e.type === "message_update" &&
            e.assistantMessageEvent.type === "text_delta"
              ? e.assistantMessageEvent.delta
              : "",
          )
          .join("");
        assert.equal(
          text,
          reply.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join(""),
          "Stream/final mismatch",
        );
      }
    }
    return last.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
  } finally {
    clearTimeout(hardStop);
    clearTimeout(abortDeadline);
    cancelAt = undefined;
  }
}
async function ack(label: string) {
  const nonce = crypto.randomUUID();
  assert.ok(
    (
      await prompt(`Reply with exactly ACK:${nonce}; do not use tools.`)
    ).includes(`ACK:${nonce}`),
  );
  checks.push(label);
}
try {
  if (mode === "check") {
    assert.ok(session.extensionRunner);
    checks.push(
      "SDK and extension load without credentials (no network request)",
    );
  } else if (mode === "login") {
    await auth.login("cursor-agent", {
      onAuth: ({ url }) =>
        console.log(`Complete login in your browser: ${url}`),
      onPrompt: async () => {
        throw new Error("Unexpected interactive prompt");
      },
    });
    checks.push("OAuth login and discovery");
  } else {
    assert.equal(
      auth.get("cursor-agent")?.type,
      "oauth",
      "Run login mode first",
    );
    registry.refresh();
    const selected = registry
      .getAvailable()
      .find(
        (m) =>
          m.provider === "cursor-agent" &&
          (!process.env["PI_CURSOR_E2E_MODEL"] ||
            m.id === process.env["PI_CURSOR_E2E_MODEL"]),
      );
    assert.ok(selected, "No usable Cursor model; rerun login/model discovery");
    await session.setModel(selected);
    evidence["model"] = selected.id;
    await ack("first authenticated request");
    readLiveSession = (await import("../src/provider/agent-stream-hook.js"))
      .getLiveSession;
    if (mode === "conversation") {
      await prompt(
        "Write a numbered list of 30 short software testing tips. Do not use tools.",
      );
      checks.push("subsequent streaming and final-text agreement");
      const nonce = crypto.randomUUID();
      fs.writeFileSync(path.join(cwd, "input.txt"), nonce);
      await prompt(
        "Use read to read input.txt, then use write to copy its exact contents into output.txt, then report completion.",
      );
      assert.equal(
        fs.readFileSync(path.join(cwd, "output.txt"), "utf8"),
        nonce,
      );
      const starts = events.filter((e) => e.type === "tool_execution_start");
      const ends = events.filter((e) => e.type === "tool_execution_end");
      assert.ok(
        starts.some((e) => e.toolName === "read") &&
          starts.some((e) => e.toolName === "write"),
        "Required tools were not executed",
      );
      for (const start of starts)
        assert.equal(
          ends.filter((e) => e.toolCallId === start.toolCallId && !e.isError)
            .length,
          1,
        );
      assert.ok(
        toolSessions.length >= 2 &&
          toolSessions[0] &&
          toolSessions.every((s) => s === toolSessions[0]),
        "Tool continuation did not reuse one live Cursor run",
      );
      checks.push("real read/write tool round trip in one live run");
      const file = manager.getSessionFile();
      assert.ok(file);
      fs.writeFileSync(resumeFile, JSON.stringify({ file, nonce }), {
        mode: 0o600,
      });
      assert.equal(await session.newSession(), true);
      await ack("new session");
      assert.equal(await session.switchSession(file), true);
      assert.ok(
        (
          await prompt(
            "Without using tools, repeat the exact contents you copied into output.txt earlier.",
          )
        ).includes(nonce),
      );
      checks.push("session A/B/A continuation");
      await prompt(
        "Write 500 numbered lines describing software tests. Do not use tools.",
        "text",
      );
      await ack("recovery after streaming cancellation");
      await prompt(
        "Use read to read input.txt, then write its contents into cancelled-output.txt.",
        "tool",
      );
      await ack("recovery after tool cancellation");
    } else if (mode === "resume") {
      assert.ok(saved);
      assert.ok(
        manager
          .getBranch()
          .some(
            (e) =>
              e.type === "custom" && e.customType === "pi-cursor-agent:state",
          ),
      );
      assert.ok(
        (
          await prompt(
            "Without using tools, repeat the exact contents copied into output.txt earlier.",
          )
        ).includes(saved.nonce),
      );
      await prompt(
        "Read output.txt and write an exact copy to resumed-output.txt.",
      );
      assert.equal(
        fs.readFileSync(path.join(cwd, "resumed-output.txt"), "utf8"),
        saved.nonce,
      );
      checks.push("fresh-process restore and subsequent tools");
    } else if (mode === "refresh-warm") {
      expireCredential();
      const cacheFile = path.join(
        directory,
        "cache",
        "pi-cursor-agent",
        "models.json",
      );
      const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      cache.lastUpdatedAt = new Date(0).toISOString();
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
      await ack("authenticated request after warm-runtime refresh");
    }
    if (mode.startsWith("refresh-")) {
      assert.ok(refreshes > 0, "No real OAuth refresh occurred");
      assert.ok(
        refreshedKeyMatches.length > 0 && refreshedKeyMatches.every(Boolean),
        "New requests did not use the refreshed access token",
      );
      const cred = auth.get("cursor-agent");
      assert.ok(
        cred?.type === "oauth" &&
          cred.access === refreshedAccess &&
          cred.expires > Date.now(),
      );
      checks.push("real refresh, persistence and new-token request");
    }
  }
  evidence["status"] = "PASS";
} catch (error) {
  evidence["status"] = "FAIL";
  // Do not serialize server errors, credentials, authorization headers or traces.
  evidence["failure"] =
    error instanceof assert.AssertionError
      ? error.message
      : "Execution failed; inspect locally without sharing secrets";
  process.exitCode = 1;
} finally {
  evidence["checks"] = checks;
  evidence["refreshes"] = refreshes;
  evidence["refreshedKeyMatches"] = refreshedKeyMatches;
  fs.writeFileSync(
    path.join(directory, `result-${mode}.json`),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(evidence, null, 2));
  await session.extensionRunner?.emit({ type: "session_shutdown" });
  session.dispose();
}
