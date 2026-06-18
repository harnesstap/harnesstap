import {
  createPrompt,
  ExitPromptError,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isSpaceKey,
  isUpKey,
  makeTheme,
  useKeypress,
  usePrefix,
  useState,
} from "@inquirer/core";
import type { ResourceType } from "../../types.js";
import type { LayerEditRow } from "../layer-edit.js";
import { renderResourceShow } from "../resource-show.js";
import {
  filterLayerEditRowsBySearch,
  formatResourceSelectionLabel,
  listNavigableLayerEditRows,
  renderFlatLayerEditTable,
  renderGroupedLayerEditTables,
  type LayerEditRenderOptions,
} from "../../ui/resource-list-render.js";
import { theme } from "../../ui/theme.js";

export type InteractiveLayerEditResult = {
  rows: LayerEditRow[];
};

type PromptView = "browse" | "show" | "constraint";

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

const interactiveLayerEditTheme = {
  helpMode: "always",
  style: {
    keysHelpTip: (keys: Array<[string, string]>) =>
      keys.map(([key, action]) => `${key} ${action}`).join(" • "),
  },
};

function isSearchCharacter(key: {
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}): key is { sequence: string } {
  return Boolean(
    key.sequence
      && key.sequence.length === 1
      && key.sequence.trim().length > 0
      && !key.ctrl
      && !key.meta
      && !key.shift,
  );
}

function isEscapeKey(key: { name?: string; sequence?: string }): boolean {
  return key.name === "escape" || key.sequence === "\u001b";
}

function clampActiveIndex(active: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  return Math.max(0, Math.min(active, length - 1));
}

function requiresVersionConstraint(row: LayerEditRow): boolean {
  return row.type === "plugin_pin" || row.type === "layer";
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
) => Promise<InteractiveLayerEditResult> = createPrompt<
  InteractiveLayerEditResult,
  PromptConfig
>((config, done) => {
  const promptTheme = makeTheme(interactiveLayerEditTheme, {});
  const prefix = usePrefix({ status: "idle", theme: promptTheme });
  const [rows, setRows] = useState(() => config.rows.map((row) => ({ ...row })));
  const [query, setQuery] = useState(config.initialQuery ?? "");
  const [active, setActive] = useState(0);
  const [view, setView] = useState<PromptView>("browse");
  const [showingRow, setShowingRow] = useState<LayerEditRow | null>(null);
  const [constraintDraft, setConstraintDraft] = useState("latest");
  const [constraintTargetId, setConstraintTargetId] = useState<string | null>(null);

  const filteredRows = filterLayerEditRowsBySearch(rows, query);
  const navigableRows = listNavigableLayerEditRows(filteredRows, config.typeFilter);
  const clampedActive = clampActiveIndex(active, navigableRows.length);
  const activeRow = navigableRows[clampedActive];
  const renderOpts: LayerEditRenderOptions = {
    showId: config.showId ?? false,
    showAll: config.showAll,
    activeRowId: activeRow?.id,
  };

  const commitConstraint = () => {
    if (!constraintTargetId) {
      return;
    }
    const constraint = constraintDraft.trim() || "latest";
    setRows(
      rows.map((row) =>
        row.id === constraintTargetId
          ? { ...row, checked: true, version_constraint: constraint }
          : row,
      ),
    );
    setConstraintTargetId(null);
    setConstraintDraft("latest");
    setView("browse");
  };

  useKeypress((key) => {
    if (view === "constraint") {
      if (isEscapeKey(key)) {
        setConstraintTargetId(null);
        setConstraintDraft("latest");
        setView("browse");
        return;
      }
      if (isEnterKey(key)) {
        commitConstraint();
        return;
      }
      if (isBackspaceKey(key)) {
        setConstraintDraft(constraintDraft.slice(0, -1));
        return;
      }
      if (isSearchCharacter(key)) {
        setConstraintDraft(constraintDraft + key.sequence);
      }
      return;
    }

    if (view === "show") {
      if (isEscapeKey(key)) {
        setView("browse");
        setShowingRow(null);
      }
      return;
    }

    if (isEscapeKey(key)) {
      throw new ExitPromptError("Layer edit cancelled");
    }

    if (key.ctrl && key.name === "s") {
      done({ rows });
      return;
    }

    if (isEnterKey(key)) {
      if (activeRow) {
        setShowingRow(activeRow);
        setView("show");
      }
      return;
    }

    if (navigableRows.length > 0 && (isUpKey(key) || isDownKey(key))) {
      const direction = isUpKey(key) ? -1 : 1;
      const next = clampActiveIndex(
        clampedActive + direction,
        navigableRows.length,
      );
      setActive(next);
      return;
    }

    if (navigableRows.length > 0 && isSpaceKey(key) && activeRow) {
      if (activeRow.checked) {
        setRows(
          rows.map((row) =>
            row.id === activeRow.id
              ? { ...row, checked: false, version_constraint: undefined }
              : row,
          ),
        );
        return;
      }

      if (requiresVersionConstraint(activeRow)) {
        setConstraintTargetId(activeRow.id);
        setConstraintDraft("latest");
        setView("constraint");
        return;
      }

      setRows(
        rows.map((row) =>
          row.id === activeRow.id ? { ...row, checked: true } : row,
        ),
      );
      return;
    }

    if (key.ctrl && key.name === "a") {
      const visibleIds = new Set(navigableRows.map((row) => row.id));
      setRows(
        rows.map((row) =>
          visibleIds.has(row.id)
            ? {
                ...row,
                checked: true,
                version_constraint: requiresVersionConstraint(row)
                  ? row.version_constraint ?? "latest"
                  : row.version_constraint,
              }
            : row,
        ),
      );
      return;
    }

    if (key.ctrl && key.name === "x") {
      const visibleIds = new Set(navigableRows.map((row) => row.id));
      setRows(
        rows.map((row) =>
          visibleIds.has(row.id)
            ? { ...row, checked: false, version_constraint: undefined }
            : row,
        ),
      );
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

  if (view === "constraint" && constraintTargetId) {
    const target = rows.find((row) => row.id === constraintTargetId);
    const helpLine = promptTheme.style.keysHelpTip([
      ["type", "constraint"],
      ["⏎", "confirm"],
      ["esc", "cancel"],
    ]);
    return [
      `${prefix} ${promptTheme.style.message(
        `Version constraint for ${target?.display_name ?? "attachment"}`,
        "idle",
      )}`,
      `Constraint: ${constraintDraft}`,
      "",
      helpLine,
    ].join("\n");
  }

  if (view === "show" && showingRow) {
    const detail = requiresVersionConstraint(showingRow)
      ? renderCompositionShow(showingRow)
      : renderResourceShow(showingRow);
    const helpLine = promptTheme.style.keysHelpTip([["esc", "back"]]);
    return [detail, "", helpLine].join("\n");
  }

  const tables = config.typeFilter
    ? renderFlatLayerEditTable(filteredRows, renderOpts)
    : renderGroupedLayerEditTables(filteredRows, renderOpts);

  const checkedCount = rows.filter((row) => row.checked).length;
  const selectionLine = activeRow
    ? `Active: ${theme.accent(formatResourceSelectionLabel(activeRow))}`
    : theme.muted("No matching resources");

  const helpLine = promptTheme.style.keysHelpTip([
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
    `${prefix} ${promptTheme.style.message(config.message, "idle")}`,
    `Search: ${query || "(type to filter)"}`,
    `Checked: ${checkedCount} attachments`,
    selectionLine,
    "",
    tables,
    "",
    helpLine,
  ].join("\n");
});
