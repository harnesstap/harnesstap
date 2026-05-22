import { readFileSync } from "node:fs";
import { getPreset, getPresetResources } from "../models/preset.js";
import { listPresetPlugins } from "../models/plugin.js";
import type { ExportBundle, Resource } from "../types.js";
import { BUNDLE_SCHEMA, BUNDLE_VERSION } from "../types.js";

export interface PresetDiffEntry {
  kind: "resource" | "plugin" | "metadata";
  key: string;
  left?: string;
  right?: string;
  change: "added" | "removed" | "modified" | "reordered";
}

export interface PresetDiffReport {
  left: string;
  right: string;
  changes: PresetDiffEntry[];
}

interface PresetView {
  label: string;
  resources: Array<{ key: string; order: number; resource: Resource }>;
  plugins: Array<{ ref: string; version_constraint: string }>;
  description: string;
  tags: string[];
  claudeJson: string;
}

function resourceKey(resource: Pick<Resource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
}

function loadPresetView(nameOrPath: string): PresetView {
  if (nameOrPath.endsWith(".json") || nameOrPath.endsWith(".harnessdeck.json")) {
    const raw = readFileSync(nameOrPath, "utf-8");
    const bundle = JSON.parse(raw) as ExportBundle;
    if (bundle.$schema !== BUNDLE_SCHEMA || bundle.version !== BUNDLE_VERSION) {
      throw new Error(`Unsupported bundle: ${nameOrPath}`);
    }
    const resources = bundle.resources.map((r, order) => ({
      key: resourceKey(r),
      order,
      resource: {
        id: `bundle:${r.type}:${r.name}`,
        type: r.type,
        name: r.name,
        description: r.description,
        content: r.content,
        metadata: r.metadata,
        source: `bundle:${nameOrPath}`,
        created_at: "",
        updated_at: "",
      },
    }));
    return {
      label: nameOrPath,
      resources,
      plugins: (bundle.plugins ?? []).map((p) => ({
        ref: p.ref,
        version_constraint: p.version_constraint,
      })),
      description: bundle.preset.description,
      tags: bundle.preset.tags,
      claudeJson: JSON.stringify(bundle.claude ?? bundle.preset.claude ?? null),
    };
  }

  const preset = getPreset(nameOrPath);
  if (!preset) {
    throw new Error(`Preset not found: ${nameOrPath}`);
  }
  const resources = getPresetResources(preset.id).map((resource, order) => ({
    key: resourceKey(resource),
    order,
    resource,
  }));
  const plugins = listPresetPlugins(preset.id).map((p) => ({
    ref: p.ref,
    version_constraint: p.version_constraint,
  }));
  return {
    label: preset.name,
    resources,
    plugins,
    description: preset.description,
    tags: preset.tags,
    claudeJson: JSON.stringify(preset.claude ?? null),
  };
}

function diffMetadata(left: PresetView, right: PresetView): PresetDiffEntry[] {
  const changes: PresetDiffEntry[] = [];
  if (left.description !== right.description) {
    changes.push({
      kind: "metadata",
      key: "description",
      left: left.description,
      right: right.description,
      change: "modified",
    });
  }
  if (JSON.stringify(left.tags) !== JSON.stringify(right.tags)) {
    changes.push({
      kind: "metadata",
      key: "tags",
      left: left.tags.join(", "),
      right: right.tags.join(", "),
      change: "modified",
    });
  }
  if (left.claudeJson !== right.claudeJson) {
    changes.push({
      kind: "metadata",
      key: "claude",
      change: "modified",
    });
  }
  return changes;
}

export function diffPresets(leftName: string, rightName: string): PresetDiffReport {
  const left = loadPresetView(leftName);
  const right = loadPresetView(rightName);
  const changes: PresetDiffEntry[] = [...diffMetadata(left, right)];

  const leftMap = new Map(left.resources.map((r) => [r.key, r]));
  const rightMap = new Map(right.resources.map((r) => [r.key, r]));

  for (const [key, entry] of leftMap) {
    const other = rightMap.get(key);
    if (!other) {
      changes.push({ kind: "resource", key, change: "removed" });
      continue;
    }
    if (entry.resource.content !== other.resource.content) {
      changes.push({ kind: "resource", key, change: "modified" });
    }
    if (entry.order !== other.order) {
      changes.push({ kind: "resource", key, change: "reordered" });
    }
  }

  for (const [key] of rightMap) {
    if (!leftMap.has(key)) {
      changes.push({ kind: "resource", key, change: "added" });
    }
  }

  const leftPlugins = new Map(left.plugins.map((p) => [p.ref, p]));
  const rightPlugins = new Map(right.plugins.map((p) => [p.ref, p]));

  for (const [ref, pin] of leftPlugins) {
    const other = rightPlugins.get(ref);
    if (!other) {
      changes.push({ kind: "plugin", key: ref, change: "removed" });
      continue;
    }
    if (pin.version_constraint !== other.version_constraint) {
      changes.push({
        kind: "plugin",
        key: ref,
        left: pin.version_constraint,
        right: other.version_constraint,
        change: "modified",
      });
    }
  }

  for (const [ref] of rightPlugins) {
    if (!leftPlugins.has(ref)) {
      changes.push({ kind: "plugin", key: ref, change: "added" });
    }
  }

  return {
    left: left.label,
    right: right.label,
    changes,
  };
}
