import type { Context, Message, Tool } from "@mariozechner/pi-ai";

interface PiSystemMessageLike {
  role: "system";
  content?: string | Array<{ type?: string; text?: string }>;
  sections?: Record<string, string | null>;
  toolsAdded?: Tool[];
  toolsRemoved?: Array<{ name: string }>;
  timestamp?: number;
}

type LegacyContext = Context & {
  systemPrompt?: string;
  tools?: Tool[];
};

export interface PiSystemState {
  /** Top-level system message content (forced prompts or legacy systemPrompt). */
  content: string;
  /** Replayed Pi 1.6 structured prompt sections (after applying patches and deletions). */
  sections: Record<string, string>;
  /** Full rendered system prompt text matching Pi 1.6 getSystemMessageText(). */
  fullText: string;
  /** Whether the transcript contained structured Pi 1.6 system sections. */
  hasStructuredSections: boolean;
}

export function isSystemMessage(
  message: unknown,
): message is PiSystemMessageLike {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { role?: unknown }).role === "system"
  );
}

function extractTextFromSystemContent(
  content: PiSystemMessageLike["content"],
): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        block?.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("");
}

/**
 * Extract active tool declarations from a Pi context.
 * Supports Pi 1.6 TranscriptContext (`role: "system"` `toolsAdded`/`toolsRemoved`)
 * and falls back to legacy `context.tools`.
 */
export function extractContextTools(context: Context): Tool[] {
  const messages = (context.messages ?? []) as unknown[];
  const tools = new Map<string, Tool>();
  let sawTranscriptToolDelta = false;

  for (const message of messages) {
    if (!isSystemMessage(message)) continue;
    if (message.toolsRemoved && message.toolsRemoved.length > 0) {
      sawTranscriptToolDelta = true;
      for (const removed of message.toolsRemoved) {
        if (removed?.name) {
          tools.delete(removed.name);
        }
      }
    }
    if (message.toolsAdded && message.toolsAdded.length > 0) {
      sawTranscriptToolDelta = true;
      for (const added of message.toolsAdded) {
        if (added?.name) {
          tools.set(added.name, added);
        }
      }
    }
  }

  if (sawTranscriptToolDelta) {
    return [...tools.values()];
  }

  return (context as LegacyContext).tools ?? [];
}

/**
 * Replay all Pi 1.6 system messages (or fall back to legacy `context.systemPrompt`)
 * into a unified system prompt state with structured sections preserved.
 */
export function extractPiSystemState(context: Context): PiSystemState {
  const messages = (context.messages ?? []) as unknown[];
  const contentParts: string[] = [];
  const sections = new Map<string, string>();
  let sawSystemMessage = false;

  for (const message of messages) {
    if (!isSystemMessage(message)) continue;
    sawSystemMessage = true;

    const text = extractTextFromSystemContent(message.content);
    if (text.length > 0) {
      contentParts.push(text);
    }

    if (message.sections && typeof message.sections === "object") {
      for (const [name, value] of Object.entries(message.sections)) {
        if (value === null) {
          sections.delete(name);
        } else if (typeof value === "string") {
          sections.set(name, value);
        }
      }
    }
  }

  if (!sawSystemMessage) {
    const legacyPrompt = (context as LegacyContext).systemPrompt ?? "";
    return {
      content: legacyPrompt,
      sections: {},
      fullText: legacyPrompt,
      hasStructuredSections: false,
    };
  }

  const content = contentParts.join("\n\n");
  const sectionsRecord = Object.fromEntries(sections);
  const fullParts: string[] = [];
  if (content.length > 0) {
    fullParts.push(content);
  }
  for (const value of sections.values()) {
    if (value.length > 0) {
      fullParts.push(value);
    }
  }

  return {
    content,
    sections: sectionsRecord,
    fullText: fullParts.join("\n\n"),
    hasStructuredSections: sections.size > 0,
  };
}

/** Return transcript messages excluding Pi 1.6 `role: "system"` entries. */
export function getNonSystemMessages(messages: Message[]): Message[] {
  return messages.filter((msg) => !isSystemMessage(msg));
}
