import { deleteLayer } from "../models/plugin-model.js";
import { ui } from "../ui/index.js";
import { promptForConfirmation } from "./wizards/shared.js";
import { shouldPromptProfileEnable } from "./profile-enable-prompt.js";

export async function maybePromptProfileLayerDelete(input: {
  layerName: string;
  layerId: string;
  format?: string;
  yes?: boolean;
  deleteLayerFlag?: boolean;
}): Promise<boolean> {
  if (input.deleteLayerFlag) {
    if (!deleteLayer(input.layerId)) {
      throw new Error(`Failed to delete layer ${input.layerName}`);
    }
    return true;
  }

  const format = input.format ?? "human";
  if (format !== "human") {
    return false;
  }

  if (!shouldPromptProfileEnable({ yes: input.yes, format })) {
    ui.hint(
      `Layer ${ui.theme.accent(input.layerName)} was kept. Delete with harnesstap layer delete ${input.layerName}`,
    );
    return false;
  }

  const confirmed = await promptForConfirmation({
    message: `Also delete layer ${input.layerName}?`,
    default: false,
  });

  if (!confirmed) {
    ui.hint(
      `Layer ${ui.theme.accent(input.layerName)} was kept. Delete with harnesstap layer delete ${input.layerName}`,
    );
    return false;
  }

  if (!deleteLayer(input.layerId)) {
    throw new Error(`Failed to delete layer ${input.layerName}`);
  }
  return true;
}
