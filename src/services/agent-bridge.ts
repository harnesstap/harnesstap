import matter from "gray-matter";
import { parse, stringify } from "smol-toml";
import type { AgentMetadata } from "../types.js";

export interface CanonicalAgent {
  name: string;
  description: string;
  instructions: string;
  metadata: AgentMetadata;
}

const CODEX_KNOWN_KEYS = new Set([
  "name",
  "description",
  "model",
  "model_reasoning_effort",
  "sandbox_mode",
  "developer_instructions",
]);

const MARKDOWN_KNOWN_KEYS = new Set([
  "name",
  "description",
  "model",
  "reasoning_effort",
  "effort",
  "sandbox_mode",
  "readonly",
  "is_background",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pickExtra(
  doc: Record<string, unknown>,
  knownKeys: Set<string>,
): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!knownKeys.has(key)) {
      extra[key] = value;
    }
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

function stringField(doc: Record<string, unknown>, key: string): string | undefined {
  return typeof doc[key] === "string" ? doc[key] : undefined;
}

function booleanField(doc: Record<string, unknown>, key: string): boolean | undefined {
  return typeof doc[key] === "boolean" ? doc[key] : undefined;
}

export function parseCodexAgentToml(raw: string): CanonicalAgent | undefined {
  let doc: Record<string, unknown>;
  try {
    const parsed = parse(raw);
    if (!isRecord(parsed)) return undefined;
    doc = parsed;
  } catch {
    return undefined;
  }

  const name = stringField(doc, "name");
  if (!name) return undefined;

  return {
    name,
    description: stringField(doc, "description") ?? "",
    instructions: stringField(doc, "developer_instructions") ?? "",
    metadata: {
      model: stringField(doc, "model"),
      reasoning_effort: stringField(doc, "model_reasoning_effort"),
      sandbox_mode: stringField(doc, "sandbox_mode"),
      extra: pickExtra(doc, CODEX_KNOWN_KEYS),
      wire_format: "codex-toml",
    },
  };
}

export function emitCodexAgentToml(agent: CanonicalAgent): string {
  const doc: Record<string, unknown> = {
    name: agent.name,
    description: agent.description || `Agent ${agent.name}`,
    ...(agent.metadata.model ? { model: agent.metadata.model } : {}),
    ...(agent.metadata.reasoning_effort
      ? { model_reasoning_effort: agent.metadata.reasoning_effort }
      : {}),
    ...(agent.metadata.sandbox_mode ? { sandbox_mode: agent.metadata.sandbox_mode } : {}),
    developer_instructions: agent.instructions,
    ...agent.metadata.extra,
  };
  return stringify(doc);
}

export function parseMarkdownAgent(
  raw: string,
  filename: string,
): CanonicalAgent | undefined {
  if (!raw.trim()) return undefined;

  let data: Record<string, unknown> = {};
  let instructions = raw;

  if (raw.startsWith("---")) {
    try {
      const parsed = matter(raw);
      if (parsed.content === raw) return undefined;
      data = parsed.data as Record<string, unknown>;
      instructions = parsed.content.trimStart();
    } catch {
      return undefined;
    }
  }

  const nameFromFile = filename.replace(/\.(agent\.)?md$/, "");
  const name = stringField(data, "name") ?? nameFromFile;
  if (!name) return undefined;

  const reasoningEffort =
    stringField(data, "reasoning_effort") ?? stringField(data, "effort");

  return {
    name,
    description: stringField(data, "description") ?? "",
    instructions,
    metadata: {
      model: stringField(data, "model"),
      reasoning_effort: reasoningEffort,
      sandbox_mode: stringField(data, "sandbox_mode"),
      readonly: booleanField(data, "readonly"),
      is_background: booleanField(data, "is_background"),
      extra: pickExtra(data, MARKDOWN_KNOWN_KEYS),
      wire_format: raw.startsWith("---") ? "markdown-frontmatter" : "markdown-body",
    },
  };
}

export type MarkdownAgentFlavor = "claude" | "cursor" | "generic";

export function emitMarkdownAgent(
  agent: CanonicalAgent,
  flavor: MarkdownAgentFlavor,
): string {
  const frontmatter: Record<string, unknown> = {
    name: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
  };

  if (flavor !== "generic") {
    if (agent.metadata.model) frontmatter.model = agent.metadata.model;
    if (agent.metadata.reasoning_effort) {
      frontmatter.reasoning_effort = agent.metadata.reasoning_effort;
    }
  }

  switch (flavor) {
    case "claude":
      if (agent.metadata.sandbox_mode) {
        frontmatter.sandbox_mode = agent.metadata.sandbox_mode;
      }
      if (agent.metadata.extra) {
        for (const [key, value] of Object.entries(agent.metadata.extra)) {
          if (!(key in frontmatter)) frontmatter[key] = value;
        }
      }
      break;
    case "cursor": {
      const readonly =
        agent.metadata.readonly ?? agent.metadata.sandbox_mode === "read-only";
      if (readonly) frontmatter.readonly = true;
      if (agent.metadata.is_background) frontmatter.is_background = true;
      if (agent.metadata.extra) {
        for (const [key, value] of Object.entries(agent.metadata.extra)) {
          if (!(key in frontmatter)) frontmatter[key] = value;
        }
      }
      break;
    }
    case "generic":
      break;
    default: {
      const _exhaustive: never = flavor;
      return _exhaustive;
    }
  }

  const nonEmpty = Object.entries(frontmatter).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );

  if (nonEmpty.length === 0) {
    return agent.instructions.trimStart();
  }

  return matter.stringify(agent.instructions, Object.fromEntries(nonEmpty));
}

export function canonicalAgentFromResource(resource: {
  name: string;
  description: string;
  content: string;
  metadata: AgentMetadata;
}): CanonicalAgent {
  return {
    name: resource.name,
    description: resource.description,
    instructions: resource.content,
    metadata: resource.metadata,
  };
}

export function normalizeAgentInput(input: {
  name: string;
  description?: string;
  content: string;
  metadata?: AgentMetadata;
  source: string;
}): {
  name: string;
  description: string;
  content: string;
  metadata: AgentMetadata;
} | undefined {
  if (input.source.endsWith(".toml") || input.metadata?.wire_format === "codex-toml") {
    const parsed = parseCodexAgentToml(input.content);
    if (!parsed) return undefined;
    return {
      name: parsed.name,
      description: parsed.description,
      content: parsed.instructions,
      metadata: { ...parsed.metadata, ...input.metadata },
    };
  }

  const filename = input.source.split("/").pop() ?? `${input.name}.md`;
  if (input.content.startsWith("---") || input.metadata?.wire_format?.startsWith("markdown")) {
    const parsed = parseMarkdownAgent(input.content, filename);
    if (!parsed) return undefined;
    return {
      name: parsed.name,
      description: parsed.description || input.description || "",
      content: parsed.instructions,
      metadata: { ...parsed.metadata, ...input.metadata },
    };
  }

  return {
    name: input.name,
    description: input.description ?? "",
    content: input.content,
    metadata: input.metadata ?? {},
  };
}
