import { listPlugins } from "../../models/plugin-model.js";
import { getActiveProfileName } from "../active-profile.js";
import { isProfilePlugin } from "../../constants/profile.js";
import { createLocalPluginPickAdapter } from "./adapters/plugin-table-browser.js";
import { createTableBrowserPrompt } from "./prompts/create-table-browser-prompt.js";

export async function runPluginShowWizard(input?: {
  message?: string;
  search?: string;
  profileMode?: boolean;
}): Promise<string | undefined> {
  const plugins = listPlugins().filter((plugin) =>
    input?.profileMode ? isProfilePlugin(plugin) : true,
  );
  if (plugins.length === 0) {
    return undefined;
  }

  const result = await createTableBrowserPrompt({
    message:
      input?.message
      ?? (input?.profileMode
        ? "Which profile do you want to show?"
        : "Which plugin do you want to show?"),
    initialQuery: input?.search,
    intent: { kind: "pick-one", action: "show" },
    adapter: createLocalPluginPickAdapter({
      plugins,
      profileMode: input?.profileMode,
      activeProfileName: input?.profileMode ? getActiveProfileName() : null,
      onPick: (plugin) => plugin.name,
    }),
  });

  if (result.kind === "pick-one") {
    return result.value;
  }

  return undefined;
}
