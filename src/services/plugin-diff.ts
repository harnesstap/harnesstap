import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { getPlugin, getPluginResources, listPluginDependencies } from "../models/plugin-model.js";
import { listDependencies } from "./plugin-dependency.js";
import type { Resource } from "../types.js";
import { isApEnvelopePath } from "./agent-plugins/envelope.js";
import { parseApPackageFiles } from "./agent-plugins/import.js";
import { readPackageFilesFromPath } from "./plugin-import.js";

export interface PluginDiffEntry {
  kind: "resource" | "plugin_pin" | "metadata";
  key: string;
  left?: string;
  right?: string;
  change: "added" | "removed" | "modified" | "reordered";
}

export interface PluginDiffReport {
  left: string;
  right: string;
  changes: PluginDiffEntry[];
}

interface PluginView {
  label: string;
  resources: Array<{ key: string; order: number; resource: Resource }>;
  plugin_pins: Array<{ ref: string; version_constraint: string }>;
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

function isPackagePath(nameOrPath: string): boolean {
  if (isApEnvelopePath(nameOrPath)) {
    return true;
  }
  try {
    if (existsSync(nameOrPath) && statSync(nameOrPath).isDirectory()) {
      return existsSync(join(nameOrPath, "plugin.json"));
    }
  } catch {
    return false;
  }
  return false;
}

function loadPluginView(nameOrPath: string): PluginView {
  if (isPackagePath(nameOrPath)) {
    const parsed = parseApPackageFiles(readPackageFilesFromPath(nameOrPath));
    const resources = parsed.resources.map((r, order) => {
      const namespace = r.namespace ?? "";
      return {
        key: resourceKey({ type: r.type, name: r.name, namespace }),
        order,
        resource: {
          id: `package:${r.type}:${r.name}`,
          type: r.type,
          name: r.name,
          description: r.description,
          content: r.content,
          metadata: r.metadata,
          source: `package:${nameOrPath}`,
          namespace,
          origin_kind: r.origin_kind ?? "manual",
          origin_ref: r.origin_ref ?? "",
          content_hash: r.content_hash ?? "",
          content_blob_ref: r.content_blob_ref ?? "",
          created_at: "",
          updated_at: "",
        },
      };
    });
    return {
      label: nameOrPath,
      resources,
      plugin_pins: parsed.dependencies.map((dependency) => ({
        ref: dependency.name,
        version_constraint: dependency.constraint,
      })),
      description: parsed.description,
      tags: parsed.keywords,
      claudeJson: JSON.stringify(parsed.claude ?? null),
      version: parsed.version,
      dependenciesJson: JSON.stringify(
        parsed.dependencies.map((d) => ({
          dependency_name: d.name,
          version_constraint: d.constraint,
        })),
      ),
    };
  }

  const plugin = getPlugin(nameOrPath);
  if (!plugin) {
    throw new Error(`Plugin not found: ${nameOrPath}`);
  }
  const resources = getPluginResources(plugin.id).map((resource, order) => ({
    key: resourceKey(resource),
    order,
    resource,
  }));
  const pluginPins = listDependencies(plugin.id).map((p) => ({
    ref: p.ref,
    version_constraint: p.version_constraint,
  }));
  const deps = listPluginDependencies(plugin.id);
  return {
    label: plugin.name,
    resources,
    plugin_pins: pluginPins,
    description: plugin.description,
    tags: plugin.tags,
    claudeJson: JSON.stringify(plugin.claude ?? null),
    version: plugin.version,
    dependenciesJson: JSON.stringify(
      deps.map((d) => ({
        dependency_name: d.dependency_name,
        version_constraint: d.version_constraint,
      })),
    ),
  };
}

function diffMetadata(left: PluginView, right: PluginView): PluginDiffEntry[] {
  const changes: PluginDiffEntry[] = [];
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

export function diffPlugins(leftName: string, rightName: string): PluginDiffReport {
  const left = loadPluginView(leftName);
  const right = loadPluginView(rightName);
  const changes: PluginDiffEntry[] = [...diffMetadata(left, right)];

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

  const leftPluginPins = new Map(left.plugin_pins.map((p) => [p.ref, p]));
  const rightPluginPins = new Map(right.plugin_pins.map((p) => [p.ref, p]));

  for (const [ref, pin] of leftPluginPins) {
    const other = rightPluginPins.get(ref);
    if (!other) {
      changes.push({ kind: "plugin_pin", key: ref, change: "removed" });
      continue;
    }
    if (pin.version_constraint !== other.version_constraint) {
      changes.push({
        kind: "plugin_pin",
        key: ref,
        left: pin.version_constraint,
        right: other.version_constraint,
        change: "modified",
      });
    }
  }

  for (const [ref] of rightPluginPins) {
    if (!leftPluginPins.has(ref)) {
      changes.push({ kind: "plugin_pin", key: ref, change: "added" });
    }
  }

  return {
    left: left.label,
    right: right.label,
    changes,
  };
}
