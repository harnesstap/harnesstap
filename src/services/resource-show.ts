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
import { packageResourceShowExtras, pluginResourceShowExtras } from "./plugin-resource-show.js";

const DEFAULT_CONTENT_LINE_LIMIT = 15;

export type ResourceShowOptions = {
  showAllFields?: boolean;
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
    `… (${totalLines} lines in content)`,
  ].join("\n");
}

function renderResourceContent(
  resource: Resource,
  extras: ReturnType<typeof resourceShowExtras>,
): string {
  if (extras) {
    if (extras.contained_resources.length === 0) {
      return "Nothing loaded yet.";
    }
    return extras.contained_resources
      .map((file) => file.relative_path)
      .join("\n");
  }
  return truncateResourceContent(resource.content);
}

export function renderResourceShow(resource: Resource, opts?: ResourceShowOptions): string {
  const extras = resourceShowExtras(resource);
  return [
    renderPanel({
      title: ["RESOURCE", formatResourceDisplayName(resource)],
      rows: resourceShowPanelRows(resource, extras, opts),
    }),
    renderSubheader("CONTENT"),
    renderResourceContent(resource, extras),
  ].join("\n");
}

export function printResourceShow(resource: Resource, opts?: ResourceShowOptions): void {
  console.log(renderResourceShow(resource, opts));
}
