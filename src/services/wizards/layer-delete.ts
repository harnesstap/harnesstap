import { listLayers } from "../../models/plugin-model.js";
import { createLocalLayerPickAdapter } from "./adapters/layer-table-browser.js";
import { createTableBrowserPrompt } from "./prompts/create-table-browser-prompt.js";
import { promptForValue } from "./shared.js";
import { matchesListSearchQuery, parseListSearchQuery } from "../../ui/list-search.js";

function filterLayersBySearch(
  layers: ReturnType<typeof listLayers>,
  search?: string,
): ReturnType<typeof listLayers> {
  if (!search?.trim()) {
    return layers;
  }
  const parsed = parseListSearchQuery(search);
  return layers.filter((layer) => {
    const haystack = `${layer.name} ${layer.version} ${layer.description ?? ""} ${layer.id}`;
    return matchesListSearchQuery(haystack, parsed);
  });
}

export async function runLayerDeleteWizard(input?: {
  search?: string;
}): Promise<string[]> {
  const layers = filterLayersBySearch(listLayers(), input?.search);
  if (layers.length > 0) {
    const result = await createTableBrowserPrompt({
      message: "Which layer do you want to delete?",
      initialQuery: input?.search,
      intent: { kind: "pick-one", action: "delete" },
      adapter: createLocalLayerPickAdapter({
        layers,
        onPick: (layer) => `${layer.name}@${layer.version}`,
      }),
    });

    if (result.kind === "pick-one") {
      return [result.value];
    }

    return [];
  }

  const selector = await promptForValue({
    message: "Layer name or ID to delete",
    default: input?.search,
  });
  return selector.length > 0 ? [selector] : [];
}
