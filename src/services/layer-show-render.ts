import { getEnvironment } from "../models/environment.js";
import {
  getLayer,
  getLayerById,
  getLayerResources,
  listLayerDependencies,
  parseLayerSelectorString,
  resolveLayerSelector,
} from "../models/layer-model.js";
import { listAttachedPluginPins } from "./layer-composition.js";
import { formatRelativeTimeWithAbsolute, shortenId } from "../ui/format.js";
import { renderPanel } from "../ui/panel.js";
import { renderSubheader } from "../ui/section.js";
import { renderTable, type Column } from "../ui/table.js";
import { theme } from "../ui/theme.js";
import type { Layer, PluginPinMetadata, Resource, ResourceType } from "../types.js";
import { RESOURCE_TYPES } from "../types.js";

export type LayerShowRenderOptions = {
  showId?: boolean;
  profileExtras?: { active: boolean };
  layerLabel?: string;
};

function formatCount(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

function summarizeResourceTypes(resources: Pick<Resource, "type">[]): string {
  const counts = new Map<ResourceType, number>();

  for (const resource of resources) {
    counts.set(resource.type, (counts.get(resource.type) ?? 0) + 1);
  }

  const summary = RESOURCE_TYPES.filter(
    (type) => (counts.get(type) ?? 0) > 0,
  ).map((type) => formatCount(counts.get(type) ?? 0, type));

  return summary.join(", ");
}

function formatLayerLabel(layer: Pick<Layer, "name" | "version">): string {
  return `${layer.name}@${layer.version}`;
}

function dependencyLayerName(dependencyName: string): string {
  const parsed = parseLayerSelectorString(dependencyName);
  if (parsed.kind === "id") {
    return dependencyName;
  }
  return parsed.name;
}

function resolveDependencyLayerVersion(
  dependencyName: string,
  versionConstraint: string,
): string {
  const name = dependencyLayerName(dependencyName);
  const resolved = getLayer(`${name}@${versionConstraint}`);
  return resolved?.version ?? "—";
}

function formatLayerDependencyRows(
  dependencies: Array<{ dependency_name: string; version_constraint: string }>,
): Array<{ name: string; version: string; constraint: string }> {
  return dependencies.map((dep) => ({
    name: dependencyLayerName(dep.dependency_name),
    version: resolveDependencyLayerVersion(dep.dependency_name, dep.version_constraint),
    constraint: dep.version_constraint,
  }));
}

function makeIdColumn(showId: boolean, width = 12): Column[] {
  return showId
    ? [{
        key: "id",
        header: "ID",
        width,
        transform: (value: string) => shortenId(String(value)),
      }]
    : [];
}

function makeResourceTypeColumn(width = 14): Column {
  return {
    key: "type",
    header: "TYPE",
    width,
    style: (value) => theme.resourceType(value),
  };
}

function resolveConfiguredLayer(selector: string, layer: Layer): Layer | undefined {
  if (/^[0-9A-Z]{26}$/.test(selector)) {
    return getLayerById(selector);
  }
  const atIdx = selector.lastIndexOf("@");
  if (atIdx > 0) {
    return resolveLayerSelector(selector);
  }
  return resolveLayerSelector(`${layer.name}@${layer.version}`);
}

export function renderLayerShow(
  layer: Layer,
  selector: string,
  opts?: LayerShowRenderOptions,
): string {
  const allResources = getLayerResources(layer.id);
  const resources = allResources.filter(
    (resource) => resource.type !== "plugin_pin" && resource.type !== "layer",
  );
  const pluginPins = listAttachedPluginPins(layer.id);
  const dependencies = listLayerDependencies(layer.id);
  const configuredLayer = resolveConfiguredLayer(selector, layer);
  const configuredLayerDefaultEnvironment = configuredLayer?.default_environment_id
    ? getEnvironment(configuredLayer.default_environment_id)
    : undefined;

  const layerLabel = opts?.layerLabel ?? formatLayerLabel(layer);
  const sections: string[] = [
    renderPanel({
      title: ["LAYER", layerLabel],
      rows: [
        ["Description", layer.description || "—"],
        ["Tags", layer.tags.length > 0 ? layer.tags.join(", ") : "—"],
        ...(opts?.profileExtras
          ? [["Active", opts.profileExtras.active ? "yes" : "no"]] as [string, string][]
          : []),
        ["Resources", `${resources.length} (${summarizeResourceTypes(resources) || "none"})`],
        ["Plugin pins", pluginPins.length === 0 ? "(none pinned)" : `${pluginPins.length}`],
        ...(configuredLayer
          ? [[
              "Default environment",
              configuredLayerDefaultEnvironment?.name
                ?? configuredLayer.default_environment_id
                ?? "—",
            ]] as [string, string][]
          : []),
        ["Updated", formatRelativeTimeWithAbsolute(layer.updated_at)],
      ],
    }),
    renderSubheader("RESOURCES"),
    renderTable({
      columns: [
        ...makeIdColumn(Boolean(opts?.showId)),
        makeResourceTypeColumn(),
        { key: "name", header: "NAME", width: 26 },
      ],
      rows: resources,
      empty: "No resources in this layer.",
    }),
  ];

  if (dependencies.length > 0) {
    sections.push(
      renderSubheader("LAYER DEPENDENCIES"),
      renderTable({
        columns: [
          { key: "name", header: "NAME", width: 22 },
          { key: "version", header: "VERSION", width: 12 },
          { key: "constraint", header: "CONSTRAINT", width: 20 },
        ],
        rows: formatLayerDependencyRows(dependencies),
      }),
    );
  }

  if (pluginPins.length > 0) {
    sections.push(
      renderSubheader("PLUGIN PINS"),
      renderTable({
        columns: [
          { key: "ref", header: "REF", width: 28 },
          { key: "version", header: "VERSION", width: 12 },
          { key: "constraint", header: "CONSTRAINT", width: 20 },
          { key: "sync", header: "SYNC", width: 14 },
        ],
        rows: pluginPins.map((pin) => {
          const metadata = pin.resource.metadata as PluginPinMetadata;
          return {
            ref: pin.ref,
            version: metadata.resolved_version ?? "—",
            constraint: pin.version_constraint || "latest",
            sync: metadata.sync_status ?? "never_synced",
          };
        }),
      }),
    );
  }

  return sections.join("\n");
}

export function renderLayerListShow(
  layer: Layer,
  opts?: LayerShowRenderOptions,
): string {
  return renderPanel({
    title: ["LAYER", opts?.layerLabel ?? formatLayerLabel(layer)],
    rows: [
      ["Description", layer.description || "—"],
      ["Tags", layer.tags.length > 0 ? layer.tags.join(", ") : "—"],
      ...(opts?.profileExtras
        ? [["Active", opts.profileExtras.active ? "yes" : "no"]] as [string, string][]
        : []),
      ["Updated", formatRelativeTimeWithAbsolute(layer.updated_at)],
    ],
  });
}

export function renderLayerShowForLayer(
  layer: Layer,
  opts?: LayerShowRenderOptions,
): string {
  return renderLayerShow(layer, `${layer.name}@${layer.version}`, opts);
}
