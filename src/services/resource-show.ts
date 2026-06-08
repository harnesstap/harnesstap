import type { Resource } from "../types.js";
import { renderPanel } from "../ui/panel.js";
import { renderSubheader } from "../ui/section.js";

function resourceShowPanelRows(resource: Resource): Array<[string, string]> {
  const panelRows: Array<[string, string]> = [
    ["Type", resource.type],
    ["Name", resource.name],
    ["Description", resource.description || "—"],
    ["Source", resource.source],
    ["Origin", `${resource.origin_kind}${resource.origin_ref ? ` (${resource.origin_ref})` : ""}`],
    ["Content hash", resource.content_hash || "—"],
    ["ID", resource.id],
    ["Created", resource.created_at],
    ["Metadata", JSON.stringify(resource.metadata)],
  ];
  if (resource.namespace) {
    panelRows.splice(2, 0, ["Namespace", resource.namespace]);
  }
  return panelRows;
}

export function renderResourceShow(resource: Resource): string {
  return [
    renderPanel({
      title: ["RESOURCE", resource.namespace ? `${resource.name}@${resource.namespace}` : resource.name],
      rows: resourceShowPanelRows(resource),
    }),
    renderSubheader("CONTENT"),
    resource.content,
  ].join("\n");
}

export function printResourceShow(resource: Resource): void {
  console.log(renderResourceShow(resource));
}
