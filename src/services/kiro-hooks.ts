import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HookMetadata, ResourceCreateInput } from "../types.js";

/**
 * Kiro hooks: one JSON file per hook under `.kiro/hooks/` (or `~/.kiro/hooks/`).
 * Schema and triggers: https://kiro.dev/docs/hooks/ and https://kiro.dev/docs/hooks/types/
 *
 * Each file HarnessTap writes is its own owned path, so removal never touches
 * a hook file the user wrote by hand.
 */
export const KIRO_HOOKS_PLATFORM_ID = "kiro";

/** HarnessTap (Claude-style) events with a direct Kiro trigger. */
const KIRO_TRIGGERS: Record<string, string> = {
  PreToolUse: "PreToolUse",
  PostToolUse: "PostToolUse",
  Stop: "Stop",
  SessionStart: "SessionStart",
  SessionEnd: "SessionEnd",
};

const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse"]);

/**
 * Kiro tool matchers use Kiro tool IDs, not Claude tool names, so only
 * "every tool" matchers translate safely. Everything else is skipped.
 */
export function kiroTriggerFor(hook: Pick<HookMetadata, "event" | "matcher">): string | null {
  const trigger = KIRO_TRIGGERS[hook.event];
  if (!trigger) return null;
  if (TOOL_EVENTS.has(hook.event)) {
    const matcher = hook.matcher?.trim();
    if (matcher && matcher !== "*" && matcher !== ".*") return null;
  }
  return trigger;
}

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "hook";
}

export function emitKiroHookFiles(
  hooks: Array<HookMetadata & { name: string }>,
  hooksDir: string,
): Array<{ path: string; content: string }> {
  const prefix = hooksDir.endsWith("/") ? hooksDir : `${hooksDir}/`;
  const files: Array<{ path: string; content: string }> = [];
  for (const hook of hooks) {
    if (hook.requires_plugin_root) continue;
    const trigger = kiroTriggerFor(hook);
    if (!trigger || !hook.script) continue;
    const entry: Record<string, unknown> = {
      name: hook.name,
      trigger,
      ...(TOOL_EVENTS.has(hook.event) ? { matcher: "*" } : {}),
      action: { type: "command", command: hook.script },
      ...(typeof hook.timeout === "number" ? { timeout: hook.timeout } : {}),
    };
    files.push({
      path: `${prefix}${safeFileName(hook.name)}.json`,
      content: `${JSON.stringify({ version: "v1", hooks: [entry] }, null, 2)}\n`,
    });
  }
  return files;
}

const KIRO_EVENTS_BY_TRIGGER: Record<string, string> = {
  ...Object.fromEntries(Object.entries(KIRO_TRIGGERS).map(([event, trigger]) => [trigger, event])),
  AgentSpawn: "SessionStart",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function scanKiroHooksDir(dirPath: string, displayPath: string): ResourceCreateInput[] {
  let files: string[];
  try {
    files = readdirSync(dirPath).filter((file) => file.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const prefix = displayPath.endsWith("/") ? displayPath : `${displayPath}/`;
  const resources: ResourceCreateInput[] = [];
  for (const file of files) {
    let document: unknown;
    try {
      document = JSON.parse(readFileSync(join(dirPath, file), "utf-8"));
    } catch {
      continue;
    }
    if (!isRecord(document) || !Array.isArray(document.hooks)) continue;
    for (const raw of document.hooks) {
      if (!isRecord(raw) || !isRecord(raw.action)) continue;
      const event = typeof raw.trigger === "string" ? KIRO_EVENTS_BY_TRIGGER[raw.trigger] : undefined;
      const command = raw.action.type === "command" ? raw.action.command : undefined;
      if (!event || typeof command !== "string") continue;
      const name =
        typeof raw.name === "string" && raw.name.length > 0 ? raw.name : file.replace(/\.json$/, "");
      const metadata: HookMetadata = {
        event,
        script: command,
        ...(typeof raw.timeout === "number" ? { timeout: raw.timeout } : {}),
        ...(typeof raw.matcher === "string" ? { matcher: raw.matcher } : {}),
      };
      resources.push({
        type: "hook",
        name,
        description: typeof raw.description === "string" ? raw.description : "",
        content: command,
        metadata,
        source: `${prefix}${file}`,
      });
    }
  }
  return resources;
}
