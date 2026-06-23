import type { TableBrowserResult } from "./prompts/table-browser-types.js";
import type { HelpAction } from "./prompts/table-browser-types.js";

export type ListHubResult =
  | { action: "filter"; query: string }
  | { action: "edit"; name: string }
  | { action: "delete"; name: string };

export function mapFilterTableBrowserResult(
  result: TableBrowserResult<string>,
): ListHubResult {
  switch (result.kind) {
    case "filter":
      return { action: "filter", query: result.query };
    case "edit":
      return { action: "edit", name: result.value };
    case "delete":
      return { action: "delete", name: result.value };
    case "pick-one":
    case "pick-many":
    case "manage":
    case "install":
    case "cancel":
      return { action: "filter", query: "" };
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

export function buildFilterListHelpActions(opts: {
  edit?: boolean;
  delete?: boolean;
}): HelpAction[] {
  return [
    ["↑↓", "select"],
    ["type", "search"],
    ["⌫", "erase"],
    ["⏎", "show"],
    ...(opts.edit ? ([["ctrl+e", "edit"]] as HelpAction[]) : []),
    ...(opts.delete ? ([["ctrl+x", "delete"]] as HelpAction[]) : []),
    ["esc", "exit"],
  ];
}
