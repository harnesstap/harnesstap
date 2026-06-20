import {
  createPrompt,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isUpKey,
  makeTheme,
  useKeypress,
  usePrefix,
  useState,
} from "@inquirer/core";
import type { EnvironmentEditRow } from "../environment-edit.js";
import { styleResourceType, theme } from "../../ui/theme.js";
import {
  buildHelpLine,
  clampActiveIndex,
  interactivePromptTheme,
  isEscapeKey,
  isSearchCharacter,
} from "./prompts/primitives.js";

export type InteractiveEnvironmentEditAction =
  | { type: "quit" }
  | { type: "cancel" }
  | { type: "edit"; rowIndex: number }
  | { type: "add" }
  | { type: "delete"; rowIndex: number };

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

function isLetterKey(
  key: { sequence?: string; ctrl?: boolean; meta?: boolean },
  letter: string,
): boolean {
  return key.sequence === letter && !key.ctrl && !key.meta;
}

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
) => Promise<InteractiveEnvironmentEditAction> = createPrompt<
  InteractiveEnvironmentEditAction,
  PromptConfig
>((config, done) => {
  const promptTheme = makeTheme(interactivePromptTheme, {});
  const prefix = usePrefix({ status: "idle", theme: promptTheme });
  const [query, setQuery] = useState(config.initialQuery ?? "");
  const [active, setActive] = useState(0);

  const filteredRows = filterEnvironmentEditRows(config.rows, query);
  const clampedActive = clampActiveIndex(active, filteredRows.length);
  const activeRow = filteredRows[clampedActive];

  useKeypress((key) => {
    if (isEscapeKey(key)) {
      done({ type: "cancel" });
      return;
    }

    if (isLetterKey(key, "q")) {
      done({ type: "quit" });
      return;
    }

    if (isLetterKey(key, "a")) {
      done({ type: "add" });
      return;
    }

    if (isLetterKey(key, "d") && activeRow) {
      const rowIndex = config.rows.indexOf(activeRow);
      if (rowIndex >= 0) {
        done({ type: "delete", rowIndex });
      }
      return;
    }

    if (isEnterKey(key) && activeRow) {
      const rowIndex = config.rows.indexOf(activeRow);
      if (rowIndex >= 0) {
        done({ type: "edit", rowIndex });
      }
      return;
    }

    if (filteredRows.length > 0 && (isUpKey(key) || isDownKey(key))) {
      const direction = isUpKey(key) ? -1 : 1;
      const next = clampActiveIndex(
        clampedActive + direction,
        filteredRows.length,
      );
      setActive(next);
      return;
    }

    if (isBackspaceKey(key)) {
      setQuery(query.slice(0, -1));
      setActive(0);
      return;
    }

    if (isSearchCharacter(key)) {
      setQuery(query + key.sequence);
      setActive(0);
    }
  });

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
    `${prefix} ${promptTheme.style.message(config.message, "idle")}`,
    `Search: ${query || "(type to filter)"}`,
    selectionLine,
    "",
    tables,
    "",
    helpLine,
  ].join("\n");
});
