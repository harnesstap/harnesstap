import type { ResourceType } from "../../types.js";
import type { LayerEditRow } from "../layer-edit.js";
import { renderResourceShow } from "../resource-show.js";
import {
  filterLayerEditRowsBySearch,
  formatResourceSelectionLabel,
  listNavigableLayerEditRows,
  renderFlatLayerEditViewport,
  renderGroupedLayerEditViewport,
  type LayerEditRenderOptions,
} from "../../ui/resource-list-render.js";
import { theme } from "../../ui/theme.js";
import { buildHelpLine } from "./prompts/primitives.js";
import { createEditableMultiSelectPrompt } from "./prompts/create-editable-multi-select-prompt.js";

export type InteractiveLayerEditResult = {
  rows: LayerEditRow[];
};

type PromptConfig = {
  message: string;
  rows: LayerEditRow[];
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

function requiresVersionConstraint(row: LayerEditRow): boolean {
  return row.type === "plugin";
}

function renderCompositionShow(row: LayerEditRow): string {
  const lines = [
    `${theme.resourceType(row.type)} ${theme.accent(row.display_name)}`,
    `Constraint: ${row.version_constraint ?? "latest"}`,
  ];
  if (row.description) {
    lines.push(row.description);
  }
  return lines.join("\n");
}

export const promptForInteractiveLayerEdit: (
  config: PromptConfig,
  context?: PromptContext,
) => Promise<InteractiveLayerEditResult> = (config, context) =>
  createEditableMultiSelectPrompt(
    {
      message: config.message,
      rows: config.rows,
      initialQuery: config.initialQuery,
      cancelMessage: "Layer edit cancelled",
      requiresVersionConstraint,
      resolveItems: (rows, query) => {
        const filtered = filterLayerEditRowsBySearch(rows, query);
        const navigable = listNavigableLayerEditRows(filtered, config.typeFilter);
        return { filtered, navigable };
      },
      renderBrowse: ({
        prefix,
        styledMessage,
        query,
        filtered,
        navigable,
        activeRow,
        active,
        checkedCount,
        terminalWidth,
        terminalRows,
      }) => {
        const renderOpts: LayerEditRenderOptions = {
          showId: config.showId ?? false,
          showAll: config.showAll,
          activeRowId: activeRow?.id,
          maxWidth: terminalWidth,
        };
        const viewportOpts = {
          ...renderOpts,
          activeIndex: active,
          navigable,
          terminalRows,
        };
        const tables = config.typeFilter
          ? renderFlatLayerEditViewport(filtered, viewportOpts)
          : renderGroupedLayerEditViewport(filtered, viewportOpts);
        const selectionLine = activeRow
          ? `Active: ${theme.accent(formatResourceSelectionLabel(activeRow as LayerEditRow))}`
          : theme.muted("No matching resources");
        const helpLine = buildHelpLine([
          ["↑↓", "navigate"],
          ["space", "toggle"],
          ["type", "search"],
          ["⌫", "erase"],
          ["⏎", "show"],
          ["ctrl+s", "save"],
          ["esc", "cancel"],
          ["ctrl+a", "all"],
          ["ctrl+x", "none"],
        ]);

        return [
          `${prefix} ${styledMessage}`,
          `Search: ${query || "(type to filter)"}`,
          `Checked: ${checkedCount} attachments`,
          selectionLine,
          "",
          tables,
          "",
          helpLine,
        ].join("\n");
      },
      renderShow: (row) => {
        const layerRow = row as LayerEditRow;
        const detail = requiresVersionConstraint(layerRow)
          ? renderCompositionShow(layerRow)
          : renderResourceShow(layerRow);
        const helpLine = buildHelpLine([["esc", "back"]]);
        return [detail, "", helpLine].join("\n");
      },
      renderConstraint: ({
        prefix,
        styledMessage,
        constraintDraft,
        helpLine,
      }) =>
        [
          `${prefix} ${styledMessage}`,
          `Constraint: ${constraintDraft}`,
          "",
          helpLine,
        ].join("\n"),
    },
    context,
  );
