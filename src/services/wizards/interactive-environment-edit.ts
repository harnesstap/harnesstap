import type { EnvironmentEditRow } from "../environment-edit.js";
import { styleResourceType, theme } from "../../ui/theme.js";
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

const KIND_LABELS: Record<EnvironmentEditRow["kind"], string> = {
  env_var: "ENV VARS",
  secret_ref: "SECRET REFS",
  model_config: "MODEL CONFIGS",
  permission: "PERMISSIONS",
};

function formatEnvironmentEditRowLabel(row: EnvironmentEditRow): string {
  switch (row.kind) {
    case "env_var":
      return `${row.key}=${row.value}`;
    case "secret_ref":
      return `${row.key} (${row.provider}:${row.ref})`;
    case "model_config":
      return row.provider
        ? `${row.name}: ${row.model} @ ${row.provider}`
        : `${row.name}: ${row.model}`;
    case "permission":
      return `${row.name}: ${row.action}:${row.pattern}`;
    default: {
      const neverRow: never = row;
      throw new Error(`Unsupported row kind: ${String(neverRow)}`);
    }
  }
}

function filterEnvironmentEditRows(
  rows: EnvironmentEditRow[],
  query: string,
): EnvironmentEditRow[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return rows;
  }

  return rows.filter((row) =>
    formatEnvironmentEditRowLabel(row).toLowerCase().includes(normalized),
  );
}

function renderGroupedEnvironmentEditTable(
  rows: EnvironmentEditRow[],
  activeRow: EnvironmentEditRow | undefined,
): string {
  if (rows.length === 0) {
    return theme.muted("No matching rows.");
  }

  const lines: string[] = [];

  for (const kind of Object.keys(KIND_LABELS) as EnvironmentEditRow["kind"][]) {
    const groupRows = rows.filter((row) => row.kind === kind);
    if (groupRows.length === 0) {
      continue;
    }

    lines.push(styleResourceType(kind));
    lines.push(KIND_LABELS[kind]);

    for (const row of groupRows) {
      const marker = row === activeRow ? theme.accent(">") : " ";
      lines.push(`${marker} ${formatEnvironmentEditRowLabel(row)}`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
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
      }) => {
        const tables = renderGroupedEnvironmentEditTable(filteredRows, activeRow);
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
