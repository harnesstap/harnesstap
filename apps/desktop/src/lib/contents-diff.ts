import { DESKTOP_HARNESS_IDS } from "./harness-meta";
import type {
  DriftFileChange,
  HarnessLiveStatus,
  ProfileContents,
} from "./types";

export type ContentsDiffKind = "added" | "removed" | "unchanged";

export interface ContentsDiffItem {
  key: string;
  kind: ContentsDiffKind;
  category: "plugin" | "resource" | "plugin_pin";
  /** Type key used for icons / summary counts. */
  iconType: string;
  label: string;
  detail?: string;
  /** Hover path for material resources. */
  path?: string;
  /** Selector for resource detail fetch (`id` or `type:name`). */
  selector?: string;
}

export interface ContentsDiff {
  added: ContentsDiffItem[];
  removed: ContentsDiffItem[];
  unchanged: ContentsDiffItem[];
}

export interface InstallGapRow {
  key: string;
  label: string;
  kind: "missing" | "outside_profile";
  iconType: "plugin" | "mcp_server";
  harnesses: string[];
}

const TYPE_ORDER = [
  "plugin",
  "skill",
  "mcp_server",
  "instruction",
  "rule",
  "agent",
  "command",
  "hook",
  "permission",
  "env_var",
  "model_config",
  "plugin_pin",
] as const;

export const TYPE_LABELS: Record<string, { one: string; other: string }> = {
  plugin: { one: "plugin", other: "plugins" },
  skill: { one: "skill", other: "skills" },
  mcp_server: { one: "MCP", other: "MCP" },
  instruction: { one: "instruction", other: "instructions" },
  rule: { one: "rule", other: "rules" },
  agent: { one: "agent", other: "agents" },
  command: { one: "command", other: "commands" },
  hook: { one: "hook", other: "hooks" },
  permission: { one: "permission", other: "permissions" },
  env_var: { one: "env var", other: "env vars" },
  model_config: { one: "model config", other: "model configs" },
  plugin_pin: { one: "plugin", other: "plugins" },
};

function labelForType(type: string, count: number): string {
  const known = TYPE_LABELS[type];
  if (known) {
    return count === 1 ? known.one : known.other;
  }
  return count === 1 ? type : `${type}s`;
}

const ORIGIN_HOVER_LABELS: Record<string, string> = {
  local_snapshot: "local",
  marketplace_link: "marketplace",
  manual: "manual",
  untracked: "untracked",
};

function inferFileChangeType(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/");
  if (/(^|\/)(\.?mcp\.json|mcp[-_]config\.json)$/i.test(normalized)) {
    return "mcp_server";
  }
  return undefined;
}

export type FileChangeHoverRow =
  | { kind: "path"; text: string }
  | { kind: "type"; text: string; type: string }
  | { kind: "origin"; text: string; originKind: string };

export function fileChangeHoverRows(input: {
  path: string;
  resource?: { type: string; name: string; origin_kind?: string | null };
}): FileChangeHoverRow[] {
  const rows: FileChangeHoverRow[] = [{ kind: "path", text: input.path }];
  const type = input.resource?.type ?? inferFileChangeType(input.path);
  if (type) {
    rows.push({ kind: "type", text: labelForType(type, 1), type });
  }
  const origin = input.resource?.origin_kind?.trim();
  if (origin) {
    rows.push({
      kind: "origin",
      text: ORIGIN_HOVER_LABELS[origin] ?? origin.replaceAll("_", " "),
      originKind: origin,
    });
  }
  return rows;
}

export function fileChangeHoverTitle(input: {
  path: string;
  resource?: { type: string; name: string; origin_kind?: string | null };
}): string {
  return fileChangeHoverRows(input)
    .map((row) => row.text)
    .join("\n");
}

function pluginKey(plugin: { id: string; name: string; version: string }): string {
  return `plugin:${plugin.id}:${plugin.name}@${plugin.version}`;
}

function resourceKey(resource: { type: string; name: string }): string {
  return `resource:${resource.type}:${resource.name}`;
}

function pinKey(pin: { ref: string }): string {
  return `pin:${pin.ref}`;
}

function itemsFromContents(contents: ProfileContents | null | undefined): Map<string, ContentsDiffItem> {
  const items = new Map<string, ContentsDiffItem>();
  if (!contents) {
    return items;
  }

  for (const plugin of contents.plugins ?? []) {
    const key = pluginKey(plugin);
    items.set(key, {
      key,
      kind: "unchanged",
      category: "plugin",
      iconType: "plugin",
      label: plugin.name,
      detail: `@${plugin.version}`,
    });
  }

  for (const resource of contents.resources ?? []) {
    const key = resourceKey(resource);
    items.set(key, {
      key,
      kind: "unchanged",
      category: "resource",
      iconType: resource.type,
      label: resource.name,
      detail: resource.type.replaceAll("_", " "),
      path: resource.source,
      selector: resource.id ?? `${resource.type}:${resource.name}`,
    });
  }

  for (const pin of contents.plugin_pins ?? []) {
    const key = pinKey(pin);
    items.set(key, {
      key,
      kind: "unchanged",
      category: "plugin_pin",
      iconType: "plugin_pin",
      label: pin.ref,
      detail: pin.version_constraint ? `@${pin.version_constraint}` : undefined,
    });
  }

  return items;
}

export function diffProfileContents(
  target: ProfileContents | null | undefined,
  live: ProfileContents | null | undefined,
): ContentsDiff {
  const targetItems = itemsFromContents(target);
  const liveItems = itemsFromContents(live);
  const added: ContentsDiffItem[] = [];
  const removed: ContentsDiffItem[] = [];
  const unchanged: ContentsDiffItem[] = [];

  for (const [key, item] of targetItems) {
    if (liveItems.has(key)) {
      unchanged.push({ ...item, kind: "unchanged" });
    } else {
      added.push({ ...item, kind: "added" });
    }
  }

  for (const [key, item] of liveItems) {
    if (!targetItems.has(key)) {
      removed.push({ ...item, kind: "removed" });
    }
  }

  return { added, removed, unchanged };
}

export function orderedTypeCounts(
  counts: Record<string, number> | null | undefined,
): Array<{ type: string; count: number; label: string }> {
  if (!counts) {
    return [];
  }
  const seen = new Set<string>();
  const rows: Array<{ type: string; count: number; label: string }> = [];

  for (const type of TYPE_ORDER) {
    const count = counts[type] ?? 0;
    if (count <= 0) {
      continue;
    }
    seen.add(type);
    rows.push({
      type,
      count,
      label: labelForType(type, count),
    });
  }

  for (const [type, count] of Object.entries(counts)) {
    if (seen.has(type) || count <= 0) {
      continue;
    }
    rows.push({
      type,
      count,
      label: labelForType(type, count),
    });
  }

  return rows;
}

export function fallbackTypeCounts(
  contents: ProfileContents | null | undefined,
): Record<string, number> {
  if (!contents) {
    return {};
  }
  if (contents.type_counts && Object.keys(contents.type_counts).length > 0) {
    return contents.type_counts;
  }

  const counts: Record<string, number> = {};
  const plugins = contents.plugins ?? [];
  const pluginPins = contents.plugin_pins ?? [];
  const mcpServers = contents.mcp_servers ?? [];
  if (plugins.length > 0) {
    counts.plugin = plugins.length;
  }
  for (const resource of contents.resources ?? []) {
    counts[resource.type] = (counts[resource.type] ?? 0) + 1;
  }
  if (pluginPins.length > 0) {
    counts.plugin_pin = pluginPins.length;
  }
  if (Object.keys(counts).length === 0 && mcpServers.length > 0) {
    counts.mcp_server = mcpServers.length;
  }
  return counts;
}

export function typeCountsFromItems(
  items: ContentsDiffItem[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.iconType] = (counts[item.iconType] ?? 0) + 1;
  }
  return counts;
}

export type StackChangeTone = "add" | "remove" | "mixed";

export interface StackChangeSummaryRow {
  type: string;
  count: number;
  label: string;
  tone: StackChangeTone;
  added: number;
  removed: number;
}

/** Aggregate add/remove stack diffs into per-type summary rows for collapsed headers. */
export function summarizeStackChanges(
  added: ContentsDiffItem[],
  removed: ContentsDiffItem[],
): StackChangeSummaryRow[] {
  const byType = new Map<string, { added: number; removed: number }>();

  for (const item of added) {
    const current = byType.get(item.iconType) ?? { added: 0, removed: 0 };
    current.added += 1;
    byType.set(item.iconType, current);
  }
  for (const item of removed) {
    const current = byType.get(item.iconType) ?? { added: 0, removed: 0 };
    current.removed += 1;
    byType.set(item.iconType, current);
  }

  const seen = new Set<string>();
  const rows: StackChangeSummaryRow[] = [];

  const pushRow = (type: string, counts: { added: number; removed: number }) => {
    const count = counts.added + counts.removed;
    if (count <= 0) {
      return;
    }
    let tone: StackChangeTone;
    if (counts.added > 0 && counts.removed > 0) {
      tone = "mixed";
    } else if (counts.added > 0) {
      tone = "add";
    } else {
      tone = "remove";
    }
    rows.push({
      type,
      count,
      label: labelForType(type, count),
      tone,
      added: counts.added,
      removed: counts.removed,
    });
  };

  for (const type of TYPE_ORDER) {
    const counts = byType.get(type);
    if (!counts) {
      continue;
    }
    seen.add(type);
    pushRow(type, counts);
  }

  for (const [type, counts] of byType) {
    if (seen.has(type)) {
      continue;
    }
    pushRow(type, counts);
  }

  return rows;
}

/** Map drift/apply file change types into user-facing apply verbs. */
export function fileChangeAction(change: DriftFileChange): {
  action: "add" | "update" | "remove";
  label: string;
} {
  switch (change.type) {
    case "deleted":
      return { action: "add", label: "add" };
    case "modified":
      return { action: "update", label: "update" };
    case "added":
      return { action: "remove", label: "remove" };
    default: {
      const neverType: never = change.type;
      return neverType;
    }
  }
}

export type FileChangeKind = "add" | "remove" | "update";

export function uniqueFileChanges(changes: DriftFileChange[]): DriftFileChange[] {
  const seen = new Set<string>();
  const deduped: DriftFileChange[] = [];
  for (const change of changes) {
    const key = `${change.type}:${change.path}:${change.platform ?? ""}`;
    if (seen.has(key) || seen.has(change.path)) {
      continue;
    }
    seen.add(key);
    seen.add(change.path);
    deduped.push(change);
  }
  return deduped;
}

function fileChangeResourceKey(change: DriftFileChange): string {
  if (change.resource) {
    return `${change.resource.type}:${change.resource.name}`;
  }
  return `path:${change.path}`;
}

const FILE_CHANGE_KIND_ORDER: FileChangeKind[] = ["add", "remove", "update"];

export interface FileChangeResourceGroup {
  key: string;
  resource: { type: string; name: string; origin_kind?: string | null } | null;
  changes: DriftFileChange[];
  kinds: FileChangeKind[];
  platforms: string[];
  singleton: boolean;
}

function sortFileChangePlatforms(ids: string[]): string[] {
  const unique = [...new Set(ids)];
  return unique.sort((left, right) => {
    const leftIndex = (DESKTOP_HARNESS_IDS as readonly string[]).indexOf(left);
    const rightIndex = (DESKTOP_HARNESS_IDS as readonly string[]).indexOf(right);
    const leftOrder = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const rightOrder = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.localeCompare(right);
  });
}

export function deriveFileChangeResourceGroup(
  key: string,
  resource: FileChangeResourceGroup["resource"],
  changes: DriftFileChange[],
): FileChangeResourceGroup {
  const kindSet = new Set<FileChangeKind>();
  const platforms: string[] = [];
  for (const change of changes) {
    kindSet.add(fileChangeAction(change).action);
    if (change.platform) {
      platforms.push(change.platform);
    }
  }
  return {
    key,
    resource,
    changes,
    kinds: FILE_CHANGE_KIND_ORDER.filter((kind) => kindSet.has(kind)),
    platforms: sortFileChangePlatforms(platforms),
    singleton: changes.length === 1,
  };
}

export function groupFileChangesByResource(
  changes: DriftFileChange[],
): FileChangeResourceGroup[] {
  const unique = uniqueFileChanges(changes);
  const groups = new Map<string, DriftFileChange[]>();
  const resources = new Map<string, FileChangeResourceGroup["resource"]>();
  const order: string[] = [];

  for (const change of unique) {
    const key = fileChangeResourceKey(change);
    const existing = groups.get(key);
    if (existing) {
      existing.push(change);
    } else {
      groups.set(key, [change]);
      order.push(key);
      resources.set(key, change.resource ?? null);
    }
  }

  return order.map((key) =>
    deriveFileChangeResourceGroup(key, resources.get(key) ?? null, groups.get(key) ?? []),
  );
}

export function countFileChangeKindResources(
  changes: DriftFileChange[],
): Record<FileChangeKind, number> {
  const keys: Record<FileChangeKind, Set<string>> = {
    add: new Set(),
    remove: new Set(),
    update: new Set(),
  };
  for (const change of changes) {
    const kind = fileChangeAction(change).action;
    keys[kind].add(fileChangeResourceKey(change));
  }
  return {
    add: keys.add.size,
    remove: keys.remove.size,
    update: keys.update.size,
  };
}

export function fileChangeMatchesKindFilter(
  change: DriftFileChange,
  selected: ReadonlySet<FileChangeKind>,
): boolean {
  if (selected.size === 0) {
    return true;
  }
  return selected.has(fileChangeAction(change).action);
}

export function aggregateInstallGaps(
  harnesses: Record<string, HarnessLiveStatus> | null | undefined,
): InstallGapRow[] {
  if (!harnesses) {
    return [];
  }

  const byKey = new Map<string, InstallGapRow>();

  for (const [harnessId, status] of Object.entries(harnesses)) {
    for (const plugin of status.plugins ?? []) {
      if (plugin.state === "installed") {
        continue;
      }
      const kind = plugin.state === "missing" ? "missing" : "outside_profile";
      const key = `plugin:${kind}:${plugin.id}`;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.harnesses.includes(harnessId)) {
          existing.harnesses.push(harnessId);
        }
        continue;
      }
      byKey.set(key, {
        key,
        label: `plugin ${plugin.id}`,
        kind,
        iconType: "plugin",
        harnesses: [harnessId],
      });
    }

    for (const mcp of status.mcp ?? []) {
      if (mcp.state === "present") {
        continue;
      }
      const kind = mcp.state === "missing" ? "missing" : "outside_profile";
      const key = `mcp:${kind}:${mcp.name}`;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.harnesses.includes(harnessId)) {
          existing.harnesses.push(harnessId);
        }
        continue;
      }
      byKey.set(key, {
        key,
        label: `mcp ${mcp.name}`,
        kind,
        iconType: "mcp_server",
        harnesses: [harnessId],
      });
    }
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "missing" ? -1 : 1;
    }
    return a.label.localeCompare(b.label);
  });
}
