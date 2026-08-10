import {
  getPluginResources,
  listPlugins,
  setPluginResourceOrder,
  touchPluginUpdatedAt,
} from "../models/plugin-model.js";
import { listResources } from "../models/resource.js";
import type { Plugin, Resource } from "../types.js";
import { RESOURCE_TYPES } from "../types.js";
import { sortResourcesByUpdatedAt, toResourceListRows } from "../ui/resource-list-render.js";
import {
  addPluginAttachment,
  listAttachedPluginRefs,
  listAttachedPluginPins,
  removePluginAttachment,
} from "./plugin-composition.js";
import { validatePluginDependencyGraph } from "./plugin-resolver.js";

export type PluginEditRow = Resource & {
  namespace: string;
  display_name: string;
  checked: boolean;
  version_constraint?: string;
  embed_on_export?: boolean;
  sync?: boolean;
};

export interface PluginEditApplyAttachment {
  key: string;
  type?: Resource["type"];
  version_constraint?: string | null;
  embed?: boolean;
  sync?: boolean;
}

export interface PluginEditScriptAdd {
  selector: string;
  type?: string;
  version?: string;
  embed?: boolean;
  sync?: boolean;
}

export interface PluginEditScriptRemove {
  selector: string;
  type?: string;
}

export interface PluginEditDiff {
  added: PluginEditRow[];
  removed: PluginEditRow[];
}

export interface PluginEditApplyResult {
  added: string[];
  removed: string[];
}

export function attachmentKey(
  resource: Pick<Resource, "type" | "name" | "namespace">,
): string {
  if (resource.namespace) {
    return `${resource.type}:${resource.name}@${resource.namespace}`;
  }
  return `${resource.type}:${resource.name}`;
}

export function sortPluginEditRowsForDisplay(rows: PluginEditRow[]): PluginEditRow[] {
  return [...rows].sort((left, right) => {
    if (left.checked !== right.checked) {
      return left.checked ? -1 : 1;
    }
    return Date.parse(right.updated_at) - Date.parse(left.updated_at);
  });
}

function pluginRowFromPlugin(
  plugin: Plugin,
  checked: boolean,
  constraint = "latest",
): PluginEditRow {
  return {
    id: `plugin-candidate:${plugin.id}`,
    type: "plugin",
    name: plugin.name,
    namespace: constraint === "latest" ? "" : constraint,
    description: plugin.description ?? "",
    source: "composition:plugin",
    origin_kind: "manual",
    origin_ref: plugin.name,
    content_hash: "",
    content_blob_ref: "",
    content: "{}",
    metadata: { source_kind: "local", version_constraint: constraint },
    created_at: plugin.created_at,
    updated_at: plugin.updated_at,
    display_name: `${plugin.name}@${plugin.version}`,
    checked,
    version_constraint: constraint,
  };
}

function isPluginDependencyRow(row: Pick<PluginEditRow, "type" | "id" | "metadata">): boolean {
  if (row.id.startsWith("plugin-candidate:")) {
    return true;
  }
  if (row.type !== "plugin") {
    return false;
  }
  const metadata = row.metadata as { source_kind?: string };
  return metadata.source_kind === "local";
}

export function buildPluginEditCandidates(target: Plugin): PluginEditRow[] {
  const attached = getPluginResources(target.id);
  const attachedKeys = new Set(attached.map(attachmentKey));
  const attachedConstraints = new Map<string, string>();

  for (const pin of listAttachedPluginPins(target.id)) {
    attachedConstraints.set(
      attachmentKey(pin.resource),
      pin.version_constraint || "latest",
    );
  }
  for (const ref of listAttachedPluginRefs(target.id)) {
    attachedConstraints.set(
      attachmentKey(ref.resource),
      ref.version_constraint || "latest",
    );
  }

  const attachedPluginNames = new Set(
    attached
      .filter((resource) => isPluginDependencyRow(resource))
      .map((resource) => resource.name),
  );

  const materialAndPins = listResources({ includeComposition: true }).filter(
    (resource) => !isPluginDependencyRow(resource),
  );

  const byId = new Map<string, PluginEditRow>();
  for (const row of toResourceListRows(materialAndPins)) {
    const key = attachmentKey(row);
    byId.set(row.id, {
      ...row,
      checked: attachedKeys.has(key),
      version_constraint: attachedConstraints.get(key),
    });
  }

  for (const attachedResource of attached) {
    if (!byId.has(attachedResource.id)) {
      const row = toResourceListRows([attachedResource])[0];
      if (!row) {
        continue;
      }
      const key = attachmentKey(row);
      byId.set(attachedResource.id, {
        ...row,
        checked: true,
        version_constraint: attachedConstraints.get(key),
      });
    }
  }

  for (const plugin of listPlugins()) {
    if (plugin.id === target.id) {
      continue;
    }
    const existing = [...byId.values()].find(
      (row) => isPluginDependencyRow(row) && row.name === plugin.name,
    );
    if (existing) {
      continue;
    }
    const key = `plugin:${plugin.name}`;
    byId.set(
      `plugin-candidate:${plugin.id}`,
      pluginRowFromPlugin(
        plugin,
        attachedPluginNames.has(plugin.name) || attachedKeys.has(key),
        attachedConstraints.get(key) ?? "latest",
      ),
    );
  }

  return [...byId.values()];
}

export function computePluginEditDiff(
  initial: PluginEditRow[],
  pending: PluginEditRow[],
): PluginEditDiff {
  const initialChecked = new Map(
    initial.filter((row) => row.checked).map((row) => [attachmentKey(row), row]),
  );
  const pendingChecked = new Map(
    pending.filter((row) => row.checked).map((row) => [attachmentKey(row), row]),
  );

  const added = [...pendingChecked.entries()]
    .filter(([key]) => !initialChecked.has(key))
    .map(([, row]) => row);
  const removed = [...initialChecked.entries()]
    .filter(([key]) => !pendingChecked.has(key))
    .map(([, row]) => row);

  return { added, removed };
}

export function validatePluginEditSelection(
  target: Plugin,
  pending: PluginEditRow[],
): void {
  for (const row of pending) {
    if (!row.checked) {
      continue;
    }
    if (isPluginDependencyRow(row) && row.name === target.name) {
      throw new Error(`Plugin "${target.name}" cannot reference itself`);
    }
  }

  const dependencyNames = pending
    .filter((row) => row.checked && isPluginDependencyRow(row))
    .map((row) => row.name);
  validatePluginDependencyGraph(target.name, dependencyNames);
}

function resolveAttachmentSelector(row: PluginEditRow): string {
  if (row.type === "plugin") {
    if (isPluginDependencyRow(row)) {
      return row.name;
    }
    return row.namespace ? `${row.name}@${row.namespace}` : row.name;
  }
  return row.namespace ? `${row.name}@${row.namespace}` : row.name;
}

function computePersistedResourceOrder(resources: Resource[]): string[] {
  const ordered: Resource[] = [];
  for (const type of RESOURCE_TYPES) {
    ordered.push(
      ...sortResourcesByUpdatedAt(
        resources.filter((resource) => resource.type === type),
      ),
    );
  }
  return ordered.map((resource) => resource.id);
}

function finalizePluginMembership(plugin: Plugin): void {
  const remaining = getPluginResources(plugin.id);
  setPluginResourceOrder(plugin.id, computePersistedResourceOrder(remaining));
  touchPluginUpdatedAt(plugin.id);
}

export function parsePluginEditApplyFile(raw: string): PluginEditApplyAttachment[] {
  const parsed = JSON.parse(raw) as { attachments?: PluginEditApplyAttachment[] };
  if (!Array.isArray(parsed.attachments)) {
    throw new Error('Invalid apply file: expected { "attachments": [ ... ] }');
  }
  return parsed.attachments;
}

export function buildPendingFromApplySpec(
  candidates: PluginEditRow[],
  attachments: PluginEditApplyAttachment[],
): PluginEditRow[] {
  const specByKey = new Map(attachments.map((item) => [item.key, item]));
  return candidates.map((row) => {
    const key = attachmentKey(row);
    const spec = specByKey.get(key);
    if (!spec) {
      return {
        ...row,
        checked: false,
        version_constraint: undefined,
        embed_on_export: undefined,
        sync: undefined,
      };
    }
    return {
      ...row,
      checked: true,
      version_constraint: spec.version_constraint ?? row.version_constraint ?? "latest",
      embed_on_export: spec.embed,
      sync: spec.sync,
    };
  });
}

export async function applyPluginEditScripting(input: {
  plugin: Plugin;
  adds: PluginEditScriptAdd[];
  removes: PluginEditScriptRemove[];
  dryRun?: boolean;
}): Promise<PluginEditApplyResult & { messages: string[] }> {
  const messages: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  if (input.dryRun) {
    return {
      added: input.adds.map((item) => item.selector),
      removed: input.removes.map((item) => item.selector),
      messages: [],
    };
  }

  for (const rem of input.removes) {
    const result = removePluginAttachment({
      plugin: input.plugin,
      selector: rem.selector,
      type: rem.type,
    });
    if (!result.removed) {
      throw new Error(result.message);
    }
    messages.push(result.message);
    removed.push(rem.selector);
  }

  for (const add of input.adds) {
    const message = await addPluginAttachment({
      plugin: input.plugin,
      selector: add.selector,
      type: add.type,
      version: add.version,
      embed: add.embed,
      sync: add.sync,
    });
    messages.push(message);
    added.push(add.selector);
  }

  finalizePluginMembership(input.plugin);
  return { added, removed, messages };
}

export async function applyPluginEdit(input: {
  plugin: Plugin;
  initial: PluginEditRow[];
  pending: PluginEditRow[];
  dryRun?: boolean;
}): Promise<PluginEditApplyResult> {
  const diff = computePluginEditDiff(input.initial, input.pending);
  validatePluginEditSelection(input.plugin, input.pending);

  if (input.dryRun) {
    return {
      added: diff.added.map(attachmentKey),
      removed: diff.removed.map(attachmentKey),
    };
  }

  for (const row of diff.removed) {
    removePluginAttachment({
      plugin: input.plugin,
      selector: resolveAttachmentSelector(row),
      type: row.type,
    });
  }

  for (const row of diff.added) {
    if (row.type === "plugin") {
      await addPluginAttachment({
        plugin: input.plugin,
        selector: resolveAttachmentSelector(row),
        type: row.type,
        version: row.version_constraint ?? "latest",
        embed: row.embed_on_export,
        sync: row.sync,
      });
      continue;
    }

    await addPluginAttachment({
      plugin: input.plugin,
      selector: resolveAttachmentSelector(row),
      type: row.type,
    });
  }

  finalizePluginMembership(input.plugin);

  return {
    added: diff.added.map(attachmentKey),
    removed: diff.removed.map(attachmentKey),
  };
}
