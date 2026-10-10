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

export type HooksJsonShape = "wrapped" | "flat";

export interface BuildHooksJsonOptions {
  version?: number;
  /** Claude-style events wrap each entry in `{ hooks: [...] }`. Cursor `hooks.json` is flat. */
  shape?: HooksJsonShape;
}

export function commandReferencesPluginRoot(command: string | undefined): boolean {
  if (!command) {
    return false;
  }
  return /CLAUDE_PLUGIN_ROOT/.test(command);
}

export function hookRequiresPluginRoot(
  hook: Pick<HookMetadata, "script" | "requires_plugin_root" | "hook_entry">,
): boolean {
  if (hook.requires_plugin_root === true) {
    return true;
  }
  if (commandReferencesPluginRoot(hook.script)) {
    return true;
  }
  const entryCommand = hook.hook_entry?.command;
  return typeof entryCommand === "string" && commandReferencesPluginRoot(entryCommand);
}

export function userHooksForHostConfig<T extends HookMetadata>(
  hooks: readonly T[],
): { hooks: T[]; skipped: T[] } {
  const keep: T[] = [];
  const skipped: T[] = [];
  for (const hook of hooks) {
    if (hookRequiresPluginRoot(hook)) {
      skipped.push(hook);
    } else {
      keep.push(hook);
    }
  }
  return { hooks: keep, skipped };
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

export function parseHooksJsonContent(
  content: string,
  displayPath: string,
): ResourceCreateInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  return scanHooksConfig(parsed as Record<string, unknown>, displayPath);
}

function scanHooksConfig(
  config: Record<string, unknown>,
  displayPath: string,
): ResourceCreateInput[] {
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

export function scanHooksFile(
  filePath: string,
  displayPath: string,
): ResourceCreateInput[] {
  const config = readJsonFile(filePath);
  if (!config) return [];
  return scanHooksConfig(config, displayPath);
}

function buildFlatHookEntry(hook: HookMetadata): Record<string, unknown> {
  const entry: Record<string, unknown> =
    hook.hook_entry && !isHookWrapper(hook.hook_entry)
      ? { ...hook.hook_entry }
      : { command: hook.script };
  if (!entry.command) {
    entry.command = hook.script;
  }
  if (typeof hook.commandWindows === "string") {
    entry.commandWindows = hook.commandWindows;
  }
  if (typeof hook.timeout === "number") {
    entry.timeout = hook.timeout;
  }
  return entry;
}

function flattenHookCommands(hook: HookMetadata): Record<string, unknown>[] {
  if (hook.hook_entry && Array.isArray(hook.hook_entry.hooks)) {
    return hook.hook_entry.hooks.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    );
  }
  return [buildFlatHookEntry(hook)];
}

function wrapEventEntries(
  hooks: Array<HookMetadata & { name?: string }>,
): unknown[] {
  const result: unknown[] = [];
  const matcherGroups = new Map<string, unknown[]>();

  for (const hook of hooks) {
    if (hook.hook_entry && Array.isArray(hook.hook_entry.hooks)) {
      result.push({ ...hook.hook_entry });
      continue;
    }

    const entry = buildFlatHookEntry(hook);
    if (typeof hook.matcher === "string" && hook.matcher.length > 0) {
      const group = matcherGroups.get(hook.matcher) ?? [];
      group.push(entry);
      matcherGroups.set(hook.matcher, group);
      continue;
    }

    result.push({ hooks: [entry] });
  }

  for (const [matcher, entries] of matcherGroups) {
    result.push({ matcher, hooks: entries });
  }

  return result;
}

function flattenEventEntries(
  hooks: Array<HookMetadata & { name?: string }>,
): unknown[] {
  const result: unknown[] = [];
  for (const hook of hooks) {
    result.push(...flattenHookCommands(hook));
  }
  return result;
}

function buildEventHookEntries(
  hooks: Array<HookMetadata & { name?: string }>,
  shape: HooksJsonShape,
): unknown[] {
  switch (shape) {
    case "flat":
      return flattenEventEntries(hooks);
    case "wrapped":
      return wrapEventEntries(hooks);
    default: {
      const _exhaustive: never = shape;
      throw new Error(`Unsupported hooks JSON shape: ${String(_exhaustive)}`);
    }
  }
}

export function buildHooksJson(
  hookResources: Array<HookMetadata & { name?: string }>,
  options: BuildHooksJsonOptions = {},
): HooksJsonDocument {
  const shape = options.shape ?? "wrapped";
  const usable = userHooksForHostConfig(hookResources).hooks;
  const byEvent = new Map<string, Array<HookMetadata & { name?: string }>>();

  for (const hook of usable) {
    const eventHooks = byEvent.get(hook.event) ?? [];
    eventHooks.push(hook);
    byEvent.set(hook.event, eventHooks);
  }

  const serializedHooks: Record<string, unknown[]> = {};
  for (const [event, eventHooks] of byEvent) {
    serializedHooks[event] = buildEventHookEntries(eventHooks, shape);
  }

  const document: HooksJsonDocument = { hooks: serializedHooks };
  if (options.version !== undefined) {
    document.version = options.version;
  }
  return document;
}

function commandFromUnknownEntry(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return undefined;
  }
  const record = entry as Record<string, unknown>;
  if (typeof record.command === "string") {
    return record.command;
  }
  if (!Array.isArray(record.hooks)) {
    return undefined;
  }
  for (const inner of record.hooks) {
    const innerCommand = commandFromUnknownEntry(inner);
    if (innerCommand) {
      return innerCommand;
    }
  }
  return undefined;
}

/** Drop user-config hook entries that only work with CLAUDE_PLUGIN_ROOT. */
export function stripPluginRootCommandsFromHooksObject(
  hooks: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      next[event] = entries;
      continue;
    }
    const kept = entries.filter((entry) => {
      const command = commandFromUnknownEntry(entry);
      return !commandReferencesPluginRoot(command);
    });
    if (kept.length > 0) {
      next[event] = kept;
    }
  }
  return next;
}
