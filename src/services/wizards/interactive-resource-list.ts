import {
  createPrompt,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isUpKey,
  makeTheme,
  useKeypress,
  usePrefix,
  useState,
} from "@inquirer/core";
import type { ResourceType } from "../../types.js";
import { renderResourceShow } from "../resource-show.js";
import {
  filterResourcesBySearch,
  formatResourceSelectionLabel,
  listNavigableResources,
  renderFlatResourceListTable,
  renderGroupedResourceListTables,
  type ResourceListRenderOptions,
  type ResourceListRow,
} from "../../ui/resource-list-render.js";
import { theme } from "../../ui/theme.js";
import {
  buildHelpLine,
  clampActiveIndex,
  interactivePromptTheme,
  isEscapeKey,
  isSearchCharacter,
} from "./prompts/primitives.js";

export type InteractiveResourceListResult = {
  query: string;
};

type PromptView = "browse" | "show";

type PromptConfig = {
  message: string;
  resources: ResourceListRow[];
  typeFilter?: ResourceType;
  showId?: boolean;
  showAll?: boolean;
  initialQuery?: string;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

export const promptForInteractiveResourceList: (
  config: PromptConfig,
  context?: PromptContext,
) => Promise<InteractiveResourceListResult> = createPrompt<
  InteractiveResourceListResult,
  PromptConfig
>((config, done) => {
  const promptTheme = makeTheme(interactivePromptTheme, {});
  const prefix = usePrefix({ status: "idle", theme: promptTheme });
  const [query, setQuery] = useState(config.initialQuery ?? "");
  const [active, setActive] = useState(0);
  const [view, setView] = useState<PromptView>("browse");
  const [showingResource, setShowingResource] = useState<ResourceListRow | null>(null);

  const filteredResources = filterResourcesBySearch(config.resources, query);
  const navigableResources = listNavigableResources(
    filteredResources,
    config.typeFilter,
  );
  const clampedActive = clampActiveIndex(active, navigableResources.length);
  const selectedResource = navigableResources[clampedActive];
  const renderOpts: ResourceListRenderOptions = {
    showId: config.showId ?? false,
    showAll: config.showAll,
    selectedResourceId: selectedResource?.id,
  };

  useKeypress((key) => {
    if (view === "show") {
      if (isEscapeKey(key)) {
        setView("browse");
        setShowingResource(null);
      }
      return;
    }

    if (isEscapeKey(key)) {
      done({ query: query.trim() });
      return;
    }

    if (isEnterKey(key)) {
      if (selectedResource) {
        setShowingResource(selectedResource);
        setView("show");
      }
      return;
    }

    if (navigableResources.length > 0 && (isUpKey(key) || isDownKey(key))) {
      const direction = isUpKey(key) ? -1 : 1;
      const next = clampActiveIndex(
        clampedActive + direction,
        navigableResources.length,
      );
      setActive(next);
      return;
    }

    if (isBackspaceKey(key)) {
      setQuery(query.slice(0, -1));
      setActive(0);
      return;
    }

    if (isSearchCharacter(key)) {
      setQuery(query + key.sequence);
      setActive(0);
    }
  });

  if (view === "show" && showingResource) {
    const helpLine = buildHelpLine([
      ["esc", "back"],
    ]);

    return [
      renderResourceShow(showingResource),
      "",
      helpLine,
    ].join("\n");
  }

  const tables = config.typeFilter
    ? renderFlatResourceListTable(filteredResources, renderOpts)
    : renderGroupedResourceListTables(filteredResources, renderOpts);

  const selectionLine = selectedResource
    ? `Show: ${theme.accent(`> ${formatResourceSelectionLabel(selectedResource)}`)}`
    : theme.muted("No matching resources");

  const helpLine = buildHelpLine([
    ["↑↓", "select"],
    ["type", "search"],
    ["⌫", "erase"],
    ["⏎", "show"],
    ["esc", "exit"],
  ]);

  return [
    `${prefix} ${promptTheme.style.message(config.message, "idle")}`,
    `Search: ${query || "(type to filter)"}`,
    selectionLine,
    "",
    tables,
    "",
    helpLine,
  ].join("\n");
});
