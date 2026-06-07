import { listPlugins } from "../../models/plugin-component.js";
import { promptForSearchableMultiSelect } from "./searchable-multi-select.js";
import { promptForValue } from "./shared.js";

function filterLayersBySearch<T extends {
  name: string;
  version: string;
  description?: string;
  id: string;
}>(layers: T[], search?: string): T[] {
  const normalizedSearch = search?.trim().toLowerCase();
  if (!normalizedSearch) {
    return layers;
  }

  return layers.filter((layer) =>
    `${layer.name} ${layer.version} ${layer.description ?? ""} ${layer.id}`
      .toLowerCase()
      .includes(normalizedSearch),
  );
}

export async function runLayerDeleteWizard(input?: {
  search?: string;
}): Promise<string[]> {
  const layers = filterLayersBySearch(listPlugins(), input?.search);
  if (layers.length > 0) {
    return promptForSearchableMultiSelect({
      message: "Which layers do you want to delete?",
      initialQuery: input?.search,
      choices: layers.map((layer) => ({
        name: `${layer.name}@${layer.version}`,
        value: `${layer.name}@${layer.version}`,
        description: layer.description,
      })),
      pageSize: 10,
      loop: false,
    });
  }

  const selector = await promptForValue({
    message: "Layer name or ID to delete",
    default: input?.search,
  });
  return selector.length > 0 ? [selector] : [];
}
