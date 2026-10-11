import { readFileSync } from "node:fs";
import type { Resource } from "../types.js";
import { formatRelativeTimeWithAbsolute } from "../ui/format.js";
import { renderPanel } from "../ui/panel.js";
import {
  formatOriginDisplayLabel,
  formatResourceDisplayName,
  packageDirectoryDisplayPath,
  resourceHumanName,
} from "../ui/resource-display.js";
import { renderSubheader } from "../ui/section.js";
import {
  type PluginContainedResource,
  packageResourceShowExtras,
  pluginResourceShowExtras,
} from "./plugin-resource-show.js";

const DEFAULT_CONTENT_LINE_LIMIT = 15;

export type ResourceShowOptions = {
  showAllFields?: boolean;
  full?: boolean;
};

function resourceShowExtras(
  resource: Resource,
): ReturnType<typeof pluginResourceShowExtras> | ReturnType<typeof packageResourceShowExtras> {
  return pluginResourceShowExtras(resource) ?? packageResourceShowExtras(resource);
}

function resourceShowPanelRows(
  resource: Resource,
  extras: ReturnType<typeof resourceShowExtras>,
  opts?: ResourceShowOptions,
): Array<[string, string]> {
  const path =
    extras && "install_path" in extras && extras.install_path
      ? extras.install_path
      : packageDirectoryDisplayPath(resource.source);
  const panelRows: Array<[string, string]> = [
    ["Type", resource.type],
    ["Name", resourceHumanName(resource)],
    ["Description", resource.description || "—"],
    ["Path", path || "—"],
    ["Origin", formatOriginDisplayLabel(
      resource.origin_kind,
      resource.origin_ref,
      { includeRef: resource.type !== "plugin" },
    )],
    ["Updated", formatRelativeTimeWithAbsolute(resource.updated_at)],
  ];
  if (resource.namespace) {
    panelRows.splice(2, 0, ["Namespace", resource.namespace]);
  }
  if (opts?.showAllFields) {
    panelRows.push(
      ["Source", resource.source],
      ["Content hash", resource.content_hash || "—"],
      ["ID", resource.id],
      ["Created", resource.created_at],
      ["Metadata", JSON.stringify(resource.metadata)],
    );
  }
  return panelRows;
}

export function truncateResourceContent(
  content: string,
  maxLines = DEFAULT_CONTENT_LINE_LIMIT,
): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) {
    return content;
  }
  const totalLines = lines.length;
  return [
    ...lines.slice(0, maxLines),
    `... (${totalLines} lines in content)`,
  ].join("\n");
}

function readContainedSkillBody(files: PluginContainedResource[]): string | undefined {
  const skillFile = files.find((file) => {
    const base = file.relative_path.split("/").at(-1)?.toLowerCase();
    return base === "skill.md";
  });
  if (!skillFile) {
    return undefined;
  }
  try {
    return readFileSync(skillFile.path, "utf-8");
  } catch {
    return undefined;
  }
}

function resolveResourceBody(
  resource: Resource,
  extras: ReturnType<typeof resourceShowExtras>,
): string {
  if (resource.type !== "plugin" && resource.content.trim().length > 0) {
    return resource.content;
  }
  if (resource.type !== "plugin" && extras && "contained_resources" in extras) {
    const fromDisk = readContainedSkillBody(extras.contained_resources);
    if (fromDisk !== undefined) {
      return fromDisk;
    }
  }
  return resource.content;
}

function renderContainedFileList(files: PluginContainedResource[]): string {
  if (files.length === 0) {
    return "Nothing loaded yet.";
  }
  return files.map((file) => file.relative_path).join("\n");
}

function renderResourceContent(
  resource: Resource,
  extras: ReturnType<typeof resourceShowExtras>,
  opts?: ResourceShowOptions,
): string {
  if (resource.type === "plugin") {
    if (!extras || extras.contained_resources.length === 0) {
      return "Nothing loaded yet.";
    }
    return renderContainedFileList(extras.contained_resources);
  }

  const body = resolveResourceBody(resource, extras);
  const renderedBody = opts?.full ? body : truncateResourceContent(body);
  if (!extras || extras.contained_resources.length === 0) {
    return renderedBody;
  }
  const companions = extras.contained_resources.filter((file) => {
    const base = file.relative_path.split("/").at(-1)?.toLowerCase();
    return base !== "skill.md";
  });
  if (companions.length === 0) {
    return renderedBody;
  }
  return [renderedBody, "", renderContainedFileList(extras.contained_resources)].join("\n");
}

export function renderResourceShow(resource: Resource, opts?: ResourceShowOptions): string {
  const extras = resourceShowExtras(resource);
  return [
    renderPanel({
      title: ["RESOURCE", formatResourceDisplayName(resource)],
      rows: resourceShowPanelRows(resource, extras, opts),
    }),
    renderSubheader("CONTENT"),
    renderResourceContent(resource, extras, opts),
  ].join("\n");
}

export function printResourceShow(resource: Resource, opts?: ResourceShowOptions): void {
  console.log(renderResourceShow(resource, opts));
}
