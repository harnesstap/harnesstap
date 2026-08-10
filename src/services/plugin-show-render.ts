import { getEnvironment } from "../models/environment.js";
import {
  getPluginById,
  getPluginResources,
  resolvePluginSelector,
} from "../models/plugin-model.js";
import { listDependencies } from "./plugin-dependency.js";
import { formatPluginVersionLabel } from "./plugin-versioning.js";
import { formatRelativeTimeWithAbsolute, shortenId } from "../ui/format.js";
import { renderPanel } from "../ui/panel.js";
import { renderSubheader } from "../ui/section.js";
import { renderTable, type Column } from "../ui/table.js";
import { theme } from "../ui/theme.js";
import type { Plugin, Resource, ResourceType } from "../types.js";
import { RESOURCE_TYPES } from "../types.js";

export type PluginShowRenderOptions = {
  showId?: boolean;
  profileExtras?: { active: boolean };
  pluginLabel?: string;
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

function formatPluginLabel(plugin: Pick<Plugin, "name" | "version" | "dirty">): string {
  return `${plugin.name}@${formatPluginVersionLabel(plugin.version, plugin.dirty)}`;
}

function formatDependencyConstraint(versionConstraint: string): string {
  return versionConstraint.trim() || "*";
}

function formatOriginLabel(origin: Plugin["origin"] | undefined): string {
  return origin || "authored";
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

function resolveConfiguredPlugin(selector: string, plugin: Plugin): Plugin | undefined {
  if (/^[0-9A-Z]{26}$/.test(selector)) {
    return getPluginById(selector);
  }
  const atIdx = selector.lastIndexOf("@");
  if (atIdx > 0) {
    return resolvePluginSelector(selector);
  }
  return resolvePluginSelector(`${plugin.name}@${plugin.version}`);
}

export function renderPluginShow(
  plugin: Plugin,
  selector: string,
  opts?: PluginShowRenderOptions,
): string {
  const allResources = getPluginResources(plugin.id);
  const resources = allResources.filter(
    (resource) => resource.type !== "plugin",
  );
  const dependencies = listDependencies(plugin.id);
  const configuredPlugin = resolveConfiguredPlugin(selector, plugin);
  const configuredPluginDefaultEnvironment = configuredPlugin?.default_environment_id
    ? getEnvironment(configuredPlugin.default_environment_id)
    : undefined;

  const pluginLabel = opts?.pluginLabel ?? formatPluginLabel(plugin);
  const sections: string[] = [
    renderPanel({
      title: ["PLUGIN", pluginLabel],
      rows: [
        ["Description", plugin.description || "—"],
        ["Tags", plugin.tags.length > 0 ? plugin.tags.join(", ") : "—"],
        ["Origin", formatOriginLabel(plugin.origin)],
        ...(opts?.profileExtras
          ? [["Active", opts.profileExtras.active ? "yes" : "no"]] as [string, string][]
          : []),
        ["Resources", `${resources.length} (${summarizeResourceTypes(resources) || "none"})`],
        [
          "Dependencies",
          dependencies.length === 0 ? "(none)" : `${dependencies.length}`,
        ],
        ...(configuredPlugin
          ? [[
              "Default environment",
              configuredPluginDefaultEnvironment?.name
                ?? configuredPlugin.default_environment_id
                ?? "—",
            ]] as [string, string][]
          : []),
        ["Updated", formatRelativeTimeWithAbsolute(plugin.updated_at)],
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
      empty: "No resources in this plugin.",
    }),
  ];

  if (dependencies.length > 0) {
    sections.push(
      renderSubheader("DEPENDENCIES"),
      renderTable({
        columns: [
          { key: "name", header: "NAME", width: 22 },
          { key: "constraint", header: "CONSTRAINT", width: 12 },
          { key: "source", header: "SOURCE", width: 14 },
        ],
        rows: dependencies.map((dependency) => ({
          name: dependency.name,
          constraint: formatDependencyConstraint(dependency.version_constraint),
          source: dependency.source_kind,
        })),
      }),
    );
  }

  return sections.join("\n");
}

export function renderPluginListShow(
  plugin: Plugin,
  opts?: PluginShowRenderOptions,
): string {
  return renderPanel({
    title: ["PLUGIN", opts?.pluginLabel ?? formatPluginLabel(plugin)],
    rows: [
      ["Description", plugin.description || "—"],
      ["Tags", plugin.tags.length > 0 ? plugin.tags.join(", ") : "—"],
      ["Origin", formatOriginLabel(plugin.origin)],
      ...(opts?.profileExtras
        ? [["Active", opts.profileExtras.active ? "yes" : "no"]] as [string, string][]
        : []),
      ["Updated", formatRelativeTimeWithAbsolute(plugin.updated_at)],
    ],
  });
}

export function renderPluginShowForPlugin(
  plugin: Plugin,
  opts?: PluginShowRenderOptions,
): string {
  return renderPluginShow(plugin, `${plugin.name}@${plugin.version}`, opts);
}
