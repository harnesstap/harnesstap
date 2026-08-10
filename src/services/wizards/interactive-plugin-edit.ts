import type { ResourceType } from "../../types.js";
import type { PluginEditRow } from "../plugin-edit.js";
import { renderResourceShow } from "../resource-show.js";
import {
  filterPluginEditRowsBySearch,
  formatResourceSelectionLabel,
  listNavigablePluginEditRows,
  renderFlatPluginEditViewport,
  renderGroupedPluginEditViewport,
  type PluginEditRenderOptions,
} from "../../ui/resource-list-render.js";
import { theme } from "../../ui/theme.js";
import { buildHelpLine } from "./prompts/primitives.js";
import { createEditableMultiSelectPrompt } from "./prompts/create-editable-multi-select-prompt.js";

export type InteractivePluginEditResult = {
  rows: PluginEditRow[];
};

type PromptConfig = {
  message: string;
  rows: PluginEditRow[];
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

function requiresVersionConstraint(row: PluginEditRow): boolean {
  return row.type === "plugin";
}

function renderCompositionShow(row: PluginEditRow): string {
  const lines = [
    `${theme.resourceType(row.type)} ${theme.accent(row.display_name)}`,
    `Constraint: ${row.version_constraint ?? "latest"}`,
  ];
  if (row.description) {
    lines.push(row.description);
  }
  return lines.join("\n");
}

export const promptForInteractivePluginEdit: (
  config: PromptConfig,
  context?: PromptContext,
) => Promise<InteractivePluginEditResult> = (config, context) =>
  createEditableMultiSelectPrompt(
    {
      message: config.message,
      rows: config.rows,
      initialQuery: config.initialQuery,
      cancelMessage: "Plugin edit cancelled",
      requiresVersionConstraint,
      resolveItems: (rows, query) => {
        const filtered = filterPluginEditRowsBySearch(rows, query);
        const navigable = listNavigablePluginEditRows(filtered, config.typeFilter);
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
        const renderOpts: PluginEditRenderOptions = {
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
          ? renderFlatPluginEditViewport(filtered, viewportOpts)
          : renderGroupedPluginEditViewport(filtered, viewportOpts);
        const selectionLine = activeRow
          ? `Active: ${theme.accent(formatResourceSelectionLabel(activeRow as PluginEditRow))}`
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
        const pluginRow = row as PluginEditRow;
        const detail = requiresVersionConstraint(pluginRow)
          ? renderCompositionShow(pluginRow)
          : renderResourceShow(pluginRow);
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
