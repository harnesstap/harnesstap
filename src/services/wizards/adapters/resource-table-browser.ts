import type { ResourceType } from "../../../types.js";
import { renderResourceShow } from "../../resource-show.js";
import {
  filterResourcesBySearch,
  formatResourceSelectionLabel,
  listNavigableResources,
  renderFlatResourceListViewport,
  renderGroupedResourceListViewport,
  type ResourceListRow,
} from "../../../ui/resource-list-render.js";
import type {
  TableBrowserAdapter,
  ViewportRenderArgs,
} from "../prompts/table-browser-types.js";

export type ResourceTableBrowserConfig = {
  resources: ResourceListRow[];
  typeFilter?: ResourceType;
  showId?: boolean;
  showAll?: boolean;
  onDelete?: (resource: ResourceListRow) => Promise<boolean>;
};

export function createResourceTableBrowserAdapter(
  config: ResourceTableBrowserConfig,
): TableBrowserAdapter<ResourceListRow, ResourceListRow> {
  return {
    resolveItems: (query) => {
      const filtered = filterResourcesBySearch(config.resources, query);
      const navigable = listNavigableResources(filtered, config.typeFilter);
      return { filtered, navigable };
    },
    renderViewport: (args: ViewportRenderArgs<ResourceListRow>) => {
      const renderOpts = {
        showId: config.showId ?? false,
        showAll: config.showAll,
        selectedResourceId: args.selectedItem?.id,
        maxWidth: args.terminalWidth,
        activeIndex: args.active,
        navigable: args.navigable,
        terminalRows: args.terminalRows,
      };
      return config.typeFilter
        ? renderFlatResourceListViewport(args.filtered, renderOpts)
        : renderGroupedResourceListViewport(args.filtered, renderOpts);
    },
    renderShow: (resource) => renderResourceShow(resource),
    onDelete: config.onDelete,
    formatDeleteConfirm: (resource) =>
      `Delete ${resource.type} "${formatResourceSelectionLabel(resource)}"?`,
    helpActions: [
      ["↑↓", "select"],
      ["type", "search"],
      ["⌫", "erase"],
      ["⏎", "show"],
      ...(config.onDelete ? ([["d", "delete"]] as Array<[string, string]>) : []),
      ["esc", "exit"],
    ],
  };
}
