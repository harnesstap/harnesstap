import type {
  DriftFileChange,
  HarnessLiveStatus,
  ProfileContents,
} from "./types";

export type ContentsDiffKind = "added" | "removed" | "unchanged";

export interface ContentsDiffItem {
  key: string;
  kind: ContentsDiffKind;
  category: "layer" | "resource" | "plugin_pin";
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
  harnesses: string[];
}

const TYPE_ORDER = [
  "layer",
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
  layer: { one: "layer", other: "layers" },
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

function layerKey(layer: { id: string; name: string; version: string }): string {
  return `layer:${layer.id}:${layer.name}@${layer.version}`;
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

  for (const layer of contents.layers ?? []) {
    const key = layerKey(layer);
    items.set(key, {
      key,
      kind: "unchanged",
      category: "layer",
      iconType: "layer",
      label: layer.name,
      detail: `@${layer.version}`,
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
  const layers = contents.layers ?? [];
  const pluginPins = contents.plugin_pins ?? [];
  const mcpServers = contents.mcp_servers ?? [];
  if (layers.length > 0) {
    counts.layer = layers.length;
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
