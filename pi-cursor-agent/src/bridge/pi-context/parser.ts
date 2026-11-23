/** Parse Pi system prompt (both Pi 1.6 structured sections and legacy flat prompts) for Cursor's RequestContext.rules. */

import type { McpToolDefinition } from "../../__generated__/agent/v1/mcp_pb";
import type { PiSystemState } from "../pi-to-cursor/transcript";

export interface PiContextFile {
  path: string;
  content: string;
}

export interface PiSkillRef {
  name: string;
  description: string;
  location: string;
}

export interface PiInstructionRule {
  path: string;
  content: string;
}

export interface ParsedPiContext {
  contextFiles: PiContextFile[];
  skills: PiSkillRef[];
  instructionRules?: PiInstructionRule[];
  cleanedPrompt: string;
}

const DEFAULT_PI_PREAMBLE =
  "You are a coding assistant running inside pi, a coding agent harness. Help users inspect files, run commands, and modify code.";

const CONTEXT_HEADING = "# Project Context";
const SKILLS_OPEN = "<available_skills>";
const SKILLS_CLOSE = "</available_skills>";

const PROJECT_INSTRUCTIONS_RE =
  /<project_instructions\s+path="([^"]+)">\s*([\s\S]*?)\s*<\/project_instructions>/g;

const SKILL_RE =
  /<skill>\s*<name>([\s\S]*?)<\/name>\s*<description>([\s\S]*?)<\/description>\s*<location>([\s\S]*?)<\/location>\s*<\/skill>/g;

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function unwrapSectionTag(sectionName: string, text: string): string {
  const trimmed = text.trim();
  const openTag = `<${sectionName}>`;
  const closeTag = `</${sectionName}>`;
  if (trimmed.startsWith(openTag) && trimmed.endsWith(closeTag)) {
    return trimmed
      .slice(openTag.length, trimmed.length - closeTag.length)
      .trim();
  }
  return trimmed;
}

function extractXmlProjectInstructions(text: string): PiContextFile[] {
  const files: PiContextFile[] = [];
  for (const match of text.matchAll(PROJECT_INSTRUCTIONS_RE)) {
    const filePath = unescapeXml((match[1] ?? "").trim());
    const content = (match[2] ?? "").trim();
    if (filePath && content) {
      files.push({ path: filePath, content });
    }
  }
  return files;
}

function extractLegacyContextFiles(prompt: string): PiContextFile[] {
  const start = prompt.indexOf(CONTEXT_HEADING);
  if (start === -1) return [];

  let end = prompt.length;
  for (const marker of [SKILLS_OPEN, "\nCurrent date: "]) {
    const idx = prompt.indexOf(marker, start);
    if (idx !== -1 && idx < end) end = idx;
  }

  return prompt
    .slice(start, end)
    .split(/^(?=## \/)/m)
    .slice(1)
    .flatMap((block) => {
      const nl = block.indexOf("\n");
      if (nl === -1) return [];
      const path = block.slice(3, nl).trim();
      const content = block.slice(nl + 1).trim();
      return path && content ? [{ path, content }] : [];
    });
}

function extractContextFiles(text: string): PiContextFile[] {
  const xmlFiles = extractXmlProjectInstructions(text);
  const legacyFiles = extractLegacyContextFiles(text);
  if (xmlFiles.length === 0) return legacyFiles;
  if (legacyFiles.length === 0) return xmlFiles;

  const seen = new Set(xmlFiles.map((f) => f.path));
  return [...xmlFiles, ...legacyFiles.filter((f) => !seen.has(f.path))];
}

function extractSkills(text: string): PiSkillRef[] {
  const openIdx = text.indexOf(SKILLS_OPEN);
  if (openIdx === -1) return [];

  const closeIdx = text.indexOf(SKILLS_CLOSE, openIdx);
  if (closeIdx === -1) return [];

  const xml = text.slice(openIdx, closeIdx + SKILLS_CLOSE.length);
  const skills: PiSkillRef[] = [];

  for (const m of xml.matchAll(SKILL_RE)) {
    if (!m[1] || !m[2] || !m[3]) continue;
    const name = unescapeXml(m[1].trim());
    const description = unescapeXml(m[2].trim());
    const location = unescapeXml(m[3].trim());
    if (name && description && location) {
      skills.push({ name, description, location });
    }
  }

  return skills;
}

function buildPiToolsRuleContent(
  toolsSection: string | undefined,
  advertisedTools: McpToolDefinition[],
): string {
  const parts: string[] = [];

  if (advertisedTools.length > 0) {
    const toolLines = advertisedTools.map((tool) => {
      const firstLine = (tool.description || "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      return firstLine
        ? `- ${tool.toolName || tool.name}: ${firstLine}`
        : `- ${tool.toolName || tool.name}`;
    });

    parts.push(
      [
        "You are running inside the Pi coding agent harness.",
        "The following Pi tools are available via the `pi-agent` MCP provider (fetch their full schemas with dynamic tool discovery if they are not listed directly):",
        ...toolLines,
      ].join("\n"),
    );
  }

  if (toolsSection) {
    const unwrapped = unwrapSectionTag("tools", toolsSection);
    if (unwrapped) {
      parts.push(`Pi active tool summary:\n${unwrapped}`);
    }
  }

  return parts.join("\n\n").trim();
}

function stripExtractedLegacyBlocks(prompt: string): string {
  let result = prompt;

  result = result.replace(PROJECT_INSTRUCTIONS_RE, "");

  const contextStart = result.indexOf(CONTEXT_HEADING);
  if (contextStart !== -1) {
    let contextEnd = result.length;
    for (const marker of [SKILLS_OPEN, "\nCurrent date: "]) {
      const idx = result.indexOf(marker, contextStart);
      if (idx !== -1 && idx < contextEnd) contextEnd = idx;
    }
    result = `${result.slice(0, contextStart)}\n${result.slice(contextEnd)}`;
  }

  const skillsOpen = result.indexOf(SKILLS_OPEN);
  if (skillsOpen !== -1) {
    const skillsClose = result.indexOf(SKILLS_CLOSE, skillsOpen);
    if (skillsClose !== -1) {
      result = `${result.slice(0, skillsOpen)}\n${result.slice(skillsClose + SKILLS_CLOSE.length)}`;
    }
  }

  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function buildStructuredInstructionRules(
  state: PiSystemState,
  advertisedTools: McpToolDefinition[],
): PiInstructionRule[] {
  const rules: PiInstructionRule[] = [];

  if (state.content.trim()) {
    const remainingContent = stripExtractedLegacyBlocks(state.content);
    if (remainingContent) {
      rules.push({
        path: "pi-agent/system-prompt",
        content: remainingContent,
      });
    }
  }

  const toolsRule = buildPiToolsRuleContent(
    state.sections["tools"],
    advertisedTools,
  );
  if (toolsRule) {
    rules.push({ path: "pi-agent/tools", content: toolsRule });
  }

  for (const [name, rawValue] of Object.entries(state.sections)) {
    if (
      name === "skills" ||
      name === "project_context" ||
      name === "cwd" ||
      name === "tools"
    ) {
      continue;
    }

    const content = unwrapSectionTag(name, rawValue);
    if (!content) continue;

    if (name === "preamble") {
      if (content !== DEFAULT_PI_PREAMBLE) {
        rules.push({ path: "pi-agent/preamble", content });
      }
      continue;
    }

    const rulePath =
      name === "mcp_servers"
        ? "pi-agent/mcp-servers"
        : name === "rules" || name === "docs" || name === "addendum"
          ? `pi-agent/${name}`
          : `pi-agent/section/${name}`;

    rules.push({ path: rulePath, content });
  }

  return rules;
}

const PRESERVED_PATTERNS = [
  /^Pi documentation[^\n]*(?:\n- [^\n]*)*/m,
  /^Current date: .+$/m,
  /^Current working directory: .+$/m,
];

function buildLegacyCleanedPrompt(
  original: string,
  hasExtracted: boolean,
): string {
  const lines = PRESERVED_PATTERNS.map((re) => original.match(re)?.[0]).filter(
    (s): s is string => s != null,
  );

  return lines.length === 0 && !hasExtracted ? original : lines.join("\n");
}

export function parsePiSystemState(
  state: PiSystemState,
  advertisedTools: McpToolDefinition[] = [],
): ParsedPiContext {
  if (!state.fullText && advertisedTools.length === 0) {
    return {
      contextFiles: [],
      skills: [],
      instructionRules: [],
      cleanedPrompt: "",
    };
  }

  try {
    const projectSource = state.sections["project_context"] ?? state.fullText;
    const skillsSource = state.sections["skills"] ?? state.fullText;

    const contextFiles = extractContextFiles(projectSource);
    const skills = extractSkills(skillsSource);

    if (state.hasStructuredSections) {
      const instructionRules = buildStructuredInstructionRules(
        state,
        advertisedTools,
      );
      return {
        contextFiles,
        skills,
        instructionRules,
        cleanedPrompt: state.fullText,
      };
    }

    const instructionRules: PiInstructionRule[] = [];
    const toolsRule = buildPiToolsRuleContent(undefined, advertisedTools);
    if (toolsRule) {
      instructionRules.push({ path: "pi-agent/tools", content: toolsRule });
    }

    const remainingPrompt = stripExtractedLegacyBlocks(state.fullText);
    if (remainingPrompt && remainingPrompt !== DEFAULT_PI_PREAMBLE) {
      instructionRules.push({
        path: "pi-agent/system-prompt",
        content: remainingPrompt,
      });
    }

    const hasExtracted = contextFiles.length > 0 || skills.length > 0;
    return {
      contextFiles,
      skills,
      instructionRules,
      cleanedPrompt: buildLegacyCleanedPrompt(state.fullText, hasExtracted),
    };
  } catch {
    return {
      contextFiles: [],
      skills: [],
      instructionRules: [],
      cleanedPrompt: state.fullText,
    };
  }
}

export function parsePiSystemPrompt(
  systemPrompt: string,
  advertisedTools: McpToolDefinition[] = [],
): ParsedPiContext {
  return parsePiSystemState(
    {
      content: systemPrompt,
      sections: {},
      fullText: systemPrompt,
      hasStructuredSections: false,
    },
    advertisedTools,
  );
}
