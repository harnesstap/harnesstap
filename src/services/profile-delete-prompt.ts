import { deletePlugin } from "../models/plugin-model.js";
import { ui } from "../ui/index.js";
import { promptForConfirmation } from "./wizards/shared.js";
import { shouldPromptProfileEnable } from "./profile-enable-prompt.js";

export async function maybePromptProfilePluginDelete(input: {
  pluginName: string;
  pluginId: string;
  format?: string;
  yes?: boolean;
  deletePluginFlag?: boolean;
}): Promise<boolean> {
  if (input.deletePluginFlag) {
    if (!deletePlugin(input.pluginId)) {
      throw new Error(`Failed to delete plugin ${input.pluginName}`);
    }
    return true;
  }

  const format = input.format ?? "human";
  if (format !== "human") {
    return false;
  }

  if (!shouldPromptProfileEnable({ yes: input.yes, format })) {
    ui.hint(
      `Plugin ${ui.theme.accent(input.pluginName)} was kept. Delete with harnesstap plugin delete ${input.pluginName}`,
    );
    return false;
  }

  const confirmed = await promptForConfirmation({
    message: `Also delete plugin ${input.pluginName}?`,
    default: false,
  });

  if (!confirmed) {
    ui.hint(
      `Plugin ${ui.theme.accent(input.pluginName)} was kept. Delete with harnesstap plugin delete ${input.pluginName}`,
    );
    return false;
  }

  if (!deletePlugin(input.pluginId)) {
    throw new Error(`Failed to delete plugin ${input.pluginName}`);
  }
  return true;
}
