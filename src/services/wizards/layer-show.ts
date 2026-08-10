import { listLayers } from "../../models/plugin-model.js";
import { getActiveProfileName } from "../active-profile.js";
import { isProfileLayer } from "../../constants/profile.js";
import { createLocalLayerPickAdapter } from "./adapters/layer-table-browser.js";
import { createTableBrowserPrompt } from "./prompts/create-table-browser-prompt.js";

export async function runLayerShowWizard(input?: {
  message?: string;
  search?: string;
  profileMode?: boolean;
}): Promise<string | undefined> {
  const layers = listLayers().filter((layer) =>
    input?.profileMode ? isProfileLayer(layer) : true,
  );
  if (layers.length === 0) {
    return undefined;
  }

  const result = await createTableBrowserPrompt({
    message:
      input?.message
      ?? (input?.profileMode
        ? "Which profile do you want to show?"
        : "Which layer do you want to show?"),
    initialQuery: input?.search,
    intent: { kind: "pick-one", action: "show" },
    adapter: createLocalLayerPickAdapter({
      layers,
      profileMode: input?.profileMode,
      activeProfileName: input?.profileMode ? getActiveProfileName() : null,
      onPick: (layer) => layer.name,
    }),
  });

  if (result.kind === "pick-one") {
    return result.value;
  }

  return undefined;
}
