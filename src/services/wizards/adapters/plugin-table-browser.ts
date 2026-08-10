import type { Plugin } from "../../../types.js";
import {
  filterLocalBrowseRows,
  renderGroupedPluginListBrowseViewport,
  toLocalBrowseRows,
  type PluginListBrowseRow,
} from "../../../ui/plugin-list-render.js";
import type {
  TableBrowserAdapter,
  ViewportRenderArgs,
} from "../prompts/table-browser-types.js";

export function createLocalPluginPickAdapter(config: {
  plugins: Plugin[];
  profileMode?: boolean;
  showId?: boolean;
  activeProfileName?: string | null;
  onPick?: (plugin: Plugin) => string;
}): TableBrowserAdapter<PluginListBrowseRow, string> {
  return {
    resolveItems: (query) => {
      const navigable = filterLocalBrowseRows(config.plugins, query);
      return { filtered: navigable, navigable };
    },
    renderViewport: (args: ViewportRenderArgs<PluginListBrowseRow>) =>
      renderGroupedPluginListBrowseViewport({
        activeIndex: args.active,
        navigable: args.navigable,
        terminalRows: args.terminalRows,
        maxWidth: args.terminalWidth,
        showId: config.showId,
        profileMode: config.profileMode,
        activeProfileName: config.activeProfileName,
      }),
    renderShow: (row) =>
      row.section === "local"
        ? `${row.plugin.name}@${row.plugin.version}`
        : "",
    onPick: (row) => {
      if (row.section !== "local") {
        return "";
      }
      return config.onPick?.(row.plugin) ?? row.plugin.name;
    },
    helpActions: [
      ["↑↓", "select"],
      ["type", "search"],
      ["⏎", "select"],
      ["esc", "cancel"],
    ],
  };
}

export function toLocalPluginPickRows(plugins: Plugin[]): PluginListBrowseRow[] {
  return toLocalBrowseRows(plugins);
}
