import { getPreset, getPresetResources, listPresetDependencies } from "../models/preset.js";
import { listPresetPlugins } from "../models/plugin.js";
import type { Resource } from "../types.js";
import { inspectBundleFile } from "./exporter.js";

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
  version: string;
  /** Serialised dependency list (name + constraint only; numeric order omitted to avoid false positives). */
  dependenciesJson: string;
}

function resourceKey(resource: Pick<Resource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
}

function loadPresetView(nameOrPath: string): PresetView {
  if (
    nameOrPath.endsWith(".json") ||
    nameOrPath.endsWith(".jsonc") ||
    nameOrPath.endsWith(".harnessdeck.json") ||
    nameOrPath.endsWith(".harnessdeck.jsonc")
  ) {
    const summary = inspectBundleFile(nameOrPath);
    if (summary.presets.length > 1) {
      throw new Error(
        `Multi-preset bundles are not supported by preset diff: ${nameOrPath}`,
      );
    }
    const [bundle] = summary.presets;
    if (!bundle) {
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
      description: bundle.description,
      tags: bundle.tags,
      claudeJson: JSON.stringify(bundle.claude ?? null),
      version: bundle.version ?? "",
      dependenciesJson: JSON.stringify(
        (bundle.dependencies ?? []).map((d) => ({
          dependency_name: d.dependency_name,
          version_constraint: d.version_constraint,
        })),
      ),
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
  const deps = listPresetDependencies(preset.id);
  return {
    label: preset.name,
    resources,
    plugins,
    description: preset.description,
    tags: preset.tags,
    claudeJson: JSON.stringify(preset.claude ?? null),
    version: preset.version,
    dependenciesJson: JSON.stringify(
      deps.map((d) => ({
        dependency_name: d.dependency_name,
        version_constraint: d.version_constraint,
      })),
    ),
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
  if (left.version !== right.version) {
    changes.push({
      kind: "metadata",
      key: "version",
      left: left.version,
      right: right.version,
      change: "modified",
    });
  }
  if (left.dependenciesJson !== right.dependenciesJson) {
    changes.push({
      kind: "metadata",
      key: "dependencies",
      left: left.dependenciesJson,
      right: right.dependenciesJson,
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
