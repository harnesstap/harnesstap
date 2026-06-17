import { readFileSync } from "node:fs";
import type { HookMetadata, ResourceCreateInput } from "../types.js";

export interface HookFileEntry {
  type?: string;
  command?: string;
  commandWindows?: string;
  timeout?: number;
  matcher?: string;
  statusMessage?: string;
  hooks?: HookFileEntry[];
}

export interface HooksJsonDocument {
  version?: number;
  hooks: Record<string, unknown[]>;
}

export interface BuildHooksJsonOptions {
  version?: number;
}

interface CollectedHookEntry {
  entry: HookFileEntry;
  matcher?: string;
}

function readJsonFile(filePath: string): Record<string, unknown> | undefined {
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isHookWrapper(entry: Record<string, unknown>): boolean {
  return (
    Array.isArray(entry.hooks) ||
    (typeof entry.matcher === "string" && entry.matcher.length > 0)
  );
}

function hookResourceName(
  event: string,
  matcher: string | undefined,
  index: number,
): string {
  if (typeof matcher === "string" && matcher.length > 0) {
    return `${event}-${matcher.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
  }
  return `${event}-${index + 1}`;
}

export function collectHookEntries(
  entries: unknown[],
  matcher: string | undefined,
  collected: CollectedHookEntry[],
): void {
  for (const item of entries) {
    if (!item || typeof item !== "object") continue;
    const hookItem = item as HookFileEntry;
    const itemMatcher =
      typeof hookItem.matcher === "string" ? hookItem.matcher : matcher;

    if (Array.isArray(hookItem.hooks)) {
      collectHookEntries(hookItem.hooks, itemMatcher, collected);
      continue;
    }

    if (typeof hookItem.command !== "string") continue;
    collected.push({ entry: hookItem, matcher: itemMatcher });
  }
}

export function scanHooksFile(
  filePath: string,
  displayPath: string,
): ResourceCreateInput[] {
  const config = readJsonFile(filePath);
  if (!config) return [];

  const hooks = config.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return [];
  }

  const resources: ResourceCreateInput[] = [];
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;

    const hookEntries: CollectedHookEntry[] = [];
    collectHookEntries(entries, undefined, hookEntries);

    hookEntries.forEach(({ entry, matcher }, index) => {
      const hookMetadata: HookMetadata = {
        event,
        script: entry.command ?? "",
        hook_entry: entry as Record<string, unknown>,
      };

      if (typeof entry.commandWindows === "string") {
        hookMetadata.commandWindows = entry.commandWindows;
      }
      if (typeof entry.timeout === "number") {
        hookMetadata.timeout = entry.timeout;
      }
      if (typeof matcher === "string" && matcher.length > 0) {
        hookMetadata.matcher = matcher;
      }

      resources.push({
        type: "hook",
        name: hookResourceName(event, matcher, index),
        description:
          typeof entry.statusMessage === "string" ? entry.statusMessage : "",
        content: entry.command ?? "",
        source: displayPath,
        metadata: hookMetadata,
      });
    });
  }

  return resources;
}

function buildFlatHookEntry(hook: HookMetadata): Record<string, unknown> {
  const entry: Record<string, unknown> = { command: hook.script };
  if (typeof hook.commandWindows === "string") {
    entry.commandWindows = hook.commandWindows;
  }
  if (typeof hook.timeout === "number") {
    entry.timeout = hook.timeout;
  }
  return entry;
}

function buildEventHookEntries(
  hooks: Array<HookMetadata & { name?: string }>,
): unknown[] {
  const result: unknown[] = [];
  const matcherGroups = new Map<string, unknown[]>();

  for (const hook of hooks) {
    if (hook.hook_entry && isHookWrapper(hook.hook_entry)) {
      result.push({ ...hook.hook_entry });
      continue;
    }

    const entry = hook.hook_entry
      ? { ...hook.hook_entry }
      : buildFlatHookEntry(hook);

    if (typeof hook.matcher === "string" && hook.matcher.length > 0) {
      const group = matcherGroups.get(hook.matcher) ?? [];
      group.push(entry);
      matcherGroups.set(hook.matcher, group);
      continue;
    }

    result.push(entry);
  }

  for (const [matcher, entries] of matcherGroups) {
    result.push({ matcher, hooks: entries });
  }

  return result;
}

export function buildHooksJson(
  hookResources: Array<HookMetadata & { name?: string }>,
  options: BuildHooksJsonOptions = {},
): HooksJsonDocument {
  const byEvent = new Map<string, Array<HookMetadata & { name?: string }>>();

  for (const hook of hookResources) {
    const eventHooks = byEvent.get(hook.event) ?? [];
    eventHooks.push(hook);
    byEvent.set(hook.event, eventHooks);
  }

  const serializedHooks: Record<string, unknown[]> = {};
  for (const [event, eventHooks] of byEvent) {
    serializedHooks[event] = buildEventHookEntries(eventHooks);
  }

  const document: HooksJsonDocument = { hooks: serializedHooks };
  if (options.version !== undefined) {
    document.version = options.version;
  }
  return document;
}
