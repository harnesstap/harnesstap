import type { ResourceType } from "../../types.js";
import { renderResourceShow } from "../resource-show.js";
import {
  filterResourcesBySearch,
  listNavigableResources,
  renderFlatResourceListViewport,
  renderGroupedResourceListViewport,
  type ResourceListRow,
} from "../../ui/resource-list-render.js";
import { theme } from "../../ui/theme.js";
import { buildHelpLine } from "./prompts/primitives.js";
import {
  createFilterListPrompt,
  type FilterListPromptResult,
} from "./prompts/create-filter-list-prompt.js";

export type InteractiveResourceListResult = FilterListPromptResult;

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
) => Promise<InteractiveResourceListResult> = (
  config,
  context,
) =>
  createFilterListPrompt<ResourceListRow>(
    {
      message: config.message,
      initialQuery: config.initialQuery,
      resolveItems: (query) => {
        const filtered = filterResourcesBySearch(config.resources, query);
        const navigable = listNavigableResources(filtered, config.typeFilter);
        return { filtered, navigable };
      },
      renderBrowse: ({
        prefix,
        styledMessage,
        query,
        selectedItem,
        filtered,
        navigable,
        terminalWidth,
        terminalRows,
        active,
      }) => {
        const renderOpts = {
          showId: config.showId ?? false,
          showAll: config.showAll,
          selectedResourceId: selectedItem?.id,
          maxWidth: terminalWidth,
          activeIndex: active,
          navigable,
          terminalRows,
        };
        const tables = config.typeFilter
          ? renderFlatResourceListViewport(filtered, renderOpts)
          : renderGroupedResourceListViewport(filtered, renderOpts);
        const helpLine = buildHelpLine([
          ["↑↓", "select"],
          ["type", "search"],
          ["⌫", "erase"],
          ["⏎", "show"],
          ["esc", "exit"],
        ]);

        return [
          `${prefix} ${styledMessage}`,
          `${theme.label("Search:")} ${query ? theme.entity(query) : theme.muted("(type to filter)")}`,
          "",
          tables,
          "",
          helpLine,
        ].join("\n");
      },
      renderShow: (resource) => {
        const helpLine = buildHelpLine([["esc", "back"]]);
        return [renderResourceShow(resource), "", helpLine].join("\n");
      },
    },
    context,
  );
