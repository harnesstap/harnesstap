import { listResources } from "../../models/resource.js";
import {
  sortResourcesByUpdatedAt,
  toResourceListRows,
  type ResourceListRow,
} from "../../ui/resource-list-render.js";
import { createResourceTableBrowserAdapter } from "./adapters/resource-table-browser.js";
import { createTableBrowserPrompt } from "./prompts/create-table-browser-prompt.js";

export async function runResourceShowWizard(input?: {
  search?: string;
}): Promise<string | undefined> {
  const resources = sortResourcesByUpdatedAt(toResourceListRows(listResources()));
  if (resources.length === 0) {
    return undefined;
  }

  const result = await createTableBrowserPrompt<ResourceListRow, string>({
    message: "Which resource do you want to show?",
    initialQuery: input?.search,
    intent: { kind: "pick-one", action: "show" },
    adapter: {
      ...createResourceTableBrowserAdapter({ resources }),
      onPick: (resource) => resource.id,
      helpActions: [
        ["↑↓", "select"],
        ["type", "search"],
        ["⏎", "show"],
        ["esc", "cancel"],
      ],
    },
  });

  if (result.kind === "pick-one") {
    return result.value;
  }

  return undefined;
}
