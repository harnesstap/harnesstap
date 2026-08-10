import { listPlugins } from "../../models/plugin-model.js";
import { createLocalPluginPickAdapter } from "./adapters/plugin-table-browser.js";
import { createTableBrowserPrompt } from "./prompts/create-table-browser-prompt.js";
import { promptForValue } from "./shared.js";
import { matchesListSearchQuery, parseListSearchQuery } from "../../ui/list-search.js";

function filterPluginsBySearch(
  plugins: ReturnType<typeof listPlugins>,
  search?: string,
): ReturnType<typeof listPlugins> {
  if (!search?.trim()) {
    return plugins;
  }
  const parsed = parseListSearchQuery(search);
  return plugins.filter((plugin) => {
    const haystack = `${plugin.name} ${plugin.version} ${plugin.description ?? ""} ${plugin.id}`;
    return matchesListSearchQuery(haystack, parsed);
  });
}

export async function runPluginDeleteWizard(input?: {
  search?: string;
}): Promise<string[]> {
  const plugins = filterPluginsBySearch(listPlugins(), input?.search);
  if (plugins.length > 0) {
    const result = await createTableBrowserPrompt({
      message: "Which plugin do you want to delete?",
      initialQuery: input?.search,
      intent: { kind: "pick-one", action: "delete" },
      adapter: createLocalPluginPickAdapter({
        plugins,
        onPick: (plugin) => `${plugin.name}@${plugin.version}`,
      }),
    });

    if (result.kind === "pick-one") {
      return [result.value];
    }

    return [];
  }

  const selector = await promptForValue({
    message: "Plugin name or ID to delete",
    default: input?.search,
  });
  return selector.length > 0 ? [selector] : [];
}
