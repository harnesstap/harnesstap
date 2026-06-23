import type { EnvironmentEditRow } from "../environment-edit.js";
import {
  formatEnvironmentEditRowLabel,
  listNavigableEnvironmentEditRows,
  renderGroupedEnvironmentEditViewport,
} from "../../ui/environment-edit-render.js";
import { theme } from "../../ui/theme.js";
import { buildHelpLine } from "./prompts/primitives.js";
import {
  createActionListPrompt,
  type ActionListPromptAction,
} from "./prompts/create-action-list-prompt.js";

export type InteractiveEnvironmentEditAction = ActionListPromptAction;

type PromptConfig = {
  message: string;
  rows: EnvironmentEditRow[];
  initialQuery?: string;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

function filterEnvironmentEditRows(
  rows: EnvironmentEditRow[],
  query: string,
): EnvironmentEditRow[] {
  const normalized = query.trim().toLowerCase();
  const filtered = normalized.length === 0
    ? rows
    : rows.filter((row) =>
        formatEnvironmentEditRowLabel(row).toLowerCase().includes(normalized),
      );
  return listNavigableEnvironmentEditRows(filtered);
}

export const promptForInteractiveEnvironmentEdit: (
  config: PromptConfig,
  context?: PromptContext,
) => Promise<InteractiveEnvironmentEditAction> = (
  config,
  context,
) =>
  createActionListPrompt<EnvironmentEditRow>(
    {
      message: config.message,
      rows: config.rows,
      initialQuery: config.initialQuery,
      filterRows: filterEnvironmentEditRows,
      renderBrowse: ({
        prefix,
        styledMessage,
        query,
        filteredRows,
        activeRow,
        active,
        terminalRows,
      }) => {
        const tables = renderGroupedEnvironmentEditViewport(filteredRows, {
          activeIndex: active,
          navigable: filteredRows,
          terminalRows,
        });
        const selectionLine = activeRow
          ? `Active: ${theme.accent(formatEnvironmentEditRowLabel(activeRow))}`
          : theme.muted("No matching rows");
        const helpLine = buildHelpLine([
          ["↑↓", "navigate"],
          ["type", "search"],
          ["⌫", "erase"],
          ["⏎", "edit"],
          ["a", "add env var"],
          ["d", "delete"],
          ["q", "quit"],
          ["esc", "cancel"],
        ]);

        return [
          `${prefix} ${styledMessage}`,
          `Search: ${query || "(type to filter)"}`,
          selectionLine,
          "",
          tables,
          "",
          helpLine,
        ].join("\n");
      },
    },
    context,
  );
