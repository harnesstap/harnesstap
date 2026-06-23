import {
  filterEnvironmentsBySearch,
  renderEnvironmentListShow,
  renderEnvironmentListViewport,
  type EnvironmentListRow,
} from "../../../ui/environment-list-render.js";
import type {
  TableBrowserAdapter,
  ViewportRenderArgs,
} from "../prompts/table-browser-types.js";
import { buildFilterListHelpActions } from "../list-browser-hub.js";

export function createEnvironmentTableBrowserAdapter(config: {
  environments: EnvironmentListRow[];
}): TableBrowserAdapter<EnvironmentListRow, string> {
  return {
    resolveItems: (query) => {
      const filtered = filterEnvironmentsBySearch(config.environments, query);
      return { filtered, navigable: filtered };
    },
    renderViewport: (args: ViewportRenderArgs<EnvironmentListRow>) =>
      renderEnvironmentListViewport({
        activeIndex: args.active,
        navigable: args.navigable,
        terminalRows: args.terminalRows,
        maxWidth: args.terminalWidth,
      }),
    renderShow: (row) => renderEnvironmentListShow(row),
    onPick: (row) => row.environment.name,
    onEdit: (row) => row.environment.name,
    formatDeleteConfirm: (row) => `Delete environment "${row.environment.name}"?`,
    helpActions: buildFilterListHelpActions({ edit: true, delete: true }),
  };
}
