import { listResources } from "../../models/resource.js";
import {
  filterResourcesBySearch,
  sortResourcesByUpdatedAt,
  toResourceListRows,
  type ResourceListRow,
} from "../../ui/resource-list-render.js";
import { createResourceTableBrowserAdapter } from "./adapters/resource-table-browser.js";
import { createTableBrowserPrompt } from "./prompts/create-table-browser-prompt.js";
import { promptForValue } from "./shared.js";

export async function runResourceDeleteWizard(input?: {
  search?: string;
}): Promise<string[]> {
  const resources = sortResourcesByUpdatedAt(toResourceListRows(listResources()));
  const filtered = input?.search
    ? filterResourcesBySearch(resources, input.search)
    : resources;

  if (filtered.length > 0) {
    const result = await createTableBrowserPrompt<ResourceListRow, string>({
      message: "Which resource do you want to delete?",
      initialQuery: input?.search,
      intent: { kind: "pick-one", action: "delete" },
      adapter: {
        ...createResourceTableBrowserAdapter({ resources: filtered }),
        onPick: (resource) => resource.id,
        helpActions: [
          ["↑↓", "select"],
          ["type", "search"],
          ["⏎", "delete"],
          ["esc", "cancel"],
        ],
      },
    });

    if (result.kind === "pick-one") {
      return [result.value];
    }

    return [];
  }

  const selector = await promptForValue({
    message: "Resource name or ID to delete",
    default: input?.search,
  });
  return selector.length > 0 ? [selector] : [];
}
