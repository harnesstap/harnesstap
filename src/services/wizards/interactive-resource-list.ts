import {
  createPrompt,
  isBackspaceKey,
  isEnterKey,
  makeTheme,
  useKeypress,
  usePrefix,
  useState,
} from "@inquirer/core";
import type { ResourceType } from "../../types.js";
import {
  filterResourcesBySearch,
  renderFlatResourceListTable,
  renderGroupedResourceListTables,
  type ResourceListRow,
} from "../../ui/resource-list-render.js";

type PromptConfig = {
  message: string;
  resources: ResourceListRow[];
  typeFilter?: ResourceType;
  showId?: boolean;
  initialQuery?: string;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

const interactiveResourceListTheme = {
  helpMode: "always",
  style: {
    keysHelpTip: (keys: Array<[string, string]>) =>
      keys.map(([key, action]) => `${key} ${action}`).join(" • "),
  },
};

function isSearchCharacter(key: {
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
}): key is { sequence: string } {
  return Boolean(
    key.sequence
      && key.sequence.length === 1
      && key.sequence.trim().length > 0
      && !key.ctrl
      && !key.meta,
  );
}

export const promptForInteractiveResourceList: (
  config: PromptConfig,
  context?: PromptContext,
) => Promise<string> = createPrompt<string, PromptConfig>((config, done) => {
  const theme = makeTheme(interactiveResourceListTheme, {});
  const prefix = usePrefix({ status: "idle", theme });
  const [query, setQuery] = useState(config.initialQuery ?? "");
  const filteredResources = filterResourcesBySearch(config.resources, query);
  const showId = config.showId ?? false;

  useKeypress((key) => {
    if (isEnterKey(key)) {
      done(query.trim());
      return;
    }

    if (isBackspaceKey(key)) {
      setQuery(query.slice(0, -1));
      return;
    }

    if (isSearchCharacter(key)) {
      setQuery(query + key.sequence);
    }
  });

  const tables = config.typeFilter
    ? renderFlatResourceListTable(filteredResources, { showId })
    : renderGroupedResourceListTables(filteredResources, { showId });

  const helpLine = theme.style.keysHelpTip([
    ["type", "search"],
    ["⌫", "erase"],
    ["⏎", "done"],
  ]);

  return [
    `${prefix} ${theme.style.message(config.message, "idle")}`,
    `Search: ${query || "(type to filter)"}`,
    "",
    tables,
    "",
    helpLine,
  ].join("\n");
});
