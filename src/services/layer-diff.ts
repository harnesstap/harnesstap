import { getPlugin, getPluginResources, listPluginDependencies } from "../models/plugin-component.js";
import { listLayerPlugins } from "../models/plugin-pins.js";
import type { Resource } from "../types.js";
import { inspectLayerExportFile } from "./exporter.js";

export interface LayerDiffEntry {
  kind: "resource" | "plugin" | "metadata";
  key: string;
  left?: string;
  right?: string;
  change: "added" | "removed" | "modified" | "reordered";
}

export interface LayerDiffReport {
  left: string;
  right: string;
  changes: LayerDiffEntry[];
}

interface LayerView {
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

function resourceKey(resource: Pick<Resource, "type" | "name" | "namespace">): string {
  if (resource.namespace) {
    return `${resource.type}:${resource.name}@${resource.namespace}`;
  }
  return `${resource.type}:${resource.name}`;
}

function loadLayerView(nameOrPath: string): LayerView {
  if (
    nameOrPath.endsWith(".json") ||
    nameOrPath.endsWith(".jsonc") ||
    nameOrPath.endsWith(".harnessdeck.json") ||
    nameOrPath.endsWith(".harnessdeck.jsonc")
  ) {
    const summary = inspectLayerExportFile(nameOrPath);
    if (summary.layers.length > 1) {
      throw new Error(
        `Multi-layer exports are not supported by layer diff: ${nameOrPath}`,
      );
    }
    const [bundle] = summary.layers;
    if (!bundle) {
      throw new Error(`Unsupported layer export: ${nameOrPath}`);
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
        namespace: r.namespace ?? "",
        origin_kind: r.origin_kind ?? "manual",
        origin_ref: r.origin_ref ?? "",
        content_hash: r.content_hash ?? "",
        content_blob_ref: r.content_blob_ref ?? "",
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

  const layer = getPlugin(nameOrPath);
  if (!layer) {
    throw new Error(`Layer not found: ${nameOrPath}`);
  }
  const resources = getPluginResources(layer.id).map((resource, order) => ({
    key: resourceKey(resource),
    order,
    resource,
  }));
  const plugins = listLayerPlugins(layer.id).map((p) => ({
    ref: p.ref,
    version_constraint: p.version_constraint,
  }));
  const deps = listPluginDependencies(layer.id);
  return {
    label: layer.name,
    resources,
    plugins,
    description: layer.description,
    tags: layer.tags,
    claudeJson: JSON.stringify(layer.claude ?? null),
    version: layer.version,
    dependenciesJson: JSON.stringify(
      deps.map((d) => ({
        dependency_name: d.dependency_name,
        version_constraint: d.version_constraint,
      })),
    ),
  };
}

function diffMetadata(left: LayerView, right: LayerView): LayerDiffEntry[] {
  const changes: LayerDiffEntry[] = [];
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

export function diffLayers(leftName: string, rightName: string): LayerDiffReport {
  const left = loadLayerView(leftName);
  const right = loadLayerView(rightName);
  const changes: LayerDiffEntry[] = [...diffMetadata(left, right)];

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
