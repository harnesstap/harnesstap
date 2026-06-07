import { listResources } from "../../models/resource.js";
import { promptForSearchableMultiSelect } from "./searchable-multi-select.js";
import { promptForValue } from "./shared.js";

function formatResourceDeleteChoice(resource: {
  type: string;
  name: string;
  namespace?: string | null;
  id: string;
}): string {
  const displayName = resource.namespace
    ? `${resource.name}@${resource.namespace}`
    : resource.name;
  return `${resource.type} ${displayName}`;
}

export async function runResourceDeleteWizard(input?: {
  search?: string;
}): Promise<string[]> {
  const resources = listResources(
    input?.search ? { search: input.search } : undefined,
  );
  if (resources.length > 0) {
    return promptForSearchableMultiSelect({
      message: "Which resources do you want to delete?",
      initialQuery: input?.search,
      choices: resources.map((resource) => ({
        name: formatResourceDeleteChoice(resource),
        value: resource.id,
        description: resource.description,
      })),
      pageSize: 10,
      loop: false,
    });
  }

  const selector = await promptForValue({
    message: "Resource name or ID to delete",
    default: input?.search,
  });
  return selector.length > 0 ? [selector] : [];
}
