import type { Layer } from "../../../types.js";
import {
  filterLocalBrowseRows,
  renderGroupedLayerListBrowseViewport,
  toLocalBrowseRows,
  type LayerListBrowseRow,
} from "../../../ui/layer-list-render.js";
import type {
  TableBrowserAdapter,
  ViewportRenderArgs,
} from "../prompts/table-browser-types.js";

export function createLocalLayerPickAdapter(config: {
  layers: Layer[];
  profileMode?: boolean;
  showId?: boolean;
  activeProfileName?: string | null;
  onPick?: (layer: Layer) => string;
}): TableBrowserAdapter<LayerListBrowseRow, string> {
  return {
    resolveItems: (query) => {
      const navigable = filterLocalBrowseRows(config.layers, query);
      return { filtered: navigable, navigable };
    },
    renderViewport: (args: ViewportRenderArgs<LayerListBrowseRow>) =>
      renderGroupedLayerListBrowseViewport({
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
        ? `${row.layer.name}@${row.layer.version}`
        : "",
    onPick: (row) => {
      if (row.section !== "local") {
        return "";
      }
      return config.onPick?.(row.layer) ?? row.layer.name;
    },
    helpActions: [
      ["↑↓", "select"],
      ["type", "search"],
      ["⏎", "select"],
      ["esc", "cancel"],
    ],
  };
}

export function toLocalLayerPickRows(layers: Layer[]): LayerListBrowseRow[] {
  return toLocalBrowseRows(layers);
}
