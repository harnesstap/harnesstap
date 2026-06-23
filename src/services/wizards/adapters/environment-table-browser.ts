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

export function createEnvironmentTableBrowserAdapter(config: {
  environments: EnvironmentListRow[];
}): TableBrowserAdapter<EnvironmentListRow, EnvironmentListRow> {
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
    helpActions: [
      ["↑↓", "select"],
      ["type", "search"],
      ["⌫", "erase"],
      ["⏎", "show"],
      ["esc", "exit"],
    ],
  };
}
