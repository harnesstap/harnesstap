import type { Resource } from "../types.js";
import { formatRelativeTimeWithAbsolute } from "../ui/format.js";
import { renderPanel } from "../ui/panel.js";
import { renderSubheader } from "../ui/section.js";

const DEFAULT_CONTENT_LINE_LIMIT = 15;

export type ResourceShowOptions = {
  showAllFields?: boolean;
};

function resourceShowPanelRows(
  resource: Resource,
  opts?: ResourceShowOptions,
): Array<[string, string]> {
  const panelRows: Array<[string, string]> = [
    ["Type", resource.type],
    ["Name", resource.name],
    ["Description", resource.description || "—"],
    ["Source", resource.source],
    ["Origin", `${resource.origin_kind}${resource.origin_ref ? ` (${resource.origin_ref})` : ""}`],
    ["Updated", formatRelativeTimeWithAbsolute(resource.updated_at)],
  ];
  if (resource.namespace) {
    panelRows.splice(2, 0, ["Namespace", resource.namespace]);
  }
  if (opts?.showAllFields) {
    panelRows.push(
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

export function renderResourceShow(resource: Resource, opts?: ResourceShowOptions): string {
  return [
    renderPanel({
      title: ["RESOURCE", resource.namespace ? `${resource.name}@${resource.namespace}` : resource.name],
      rows: resourceShowPanelRows(resource, opts),
    }),
    renderSubheader("CONTENT"),
    truncateResourceContent(resource.content),
  ].join("\n");
}

export function printResourceShow(resource: Resource, opts?: ResourceShowOptions): void {
  console.log(renderResourceShow(resource, opts));
}
