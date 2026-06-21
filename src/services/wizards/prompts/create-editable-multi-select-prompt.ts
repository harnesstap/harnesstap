import {
  createPrompt,
  ExitPromptError,
  isBackspaceKey,
  isEnterKey,
  isSpaceKey,
  makeTheme,
  useKeypress,
  usePrefix,
  useState,
} from "@inquirer/core";
import {
  handleEnterToShow,
  handleShowViewEscape,
  type BrowseShowView,
} from "./hooks/use-browse-show-view.js";
import { handleNavigationKeypress } from "./hooks/use-list-navigation.js";
import { handleSearchKeypress } from "./hooks/use-local-query-filter.js";
import {
  buildHelpLine,
  clampActiveIndex,
  interactivePromptTheme,
  isEscapeKey,
  isSearchCharacter,
} from "./primitives.js";

type PromptView = BrowseShowView | "constraint";

export type EditableMultiSelectPromptResult<T> = {
  rows: T[];
};

export type EditableMultiSelectRow = {
  id: string;
  checked: boolean;
  version_constraint?: string;
};

export type EditableMultiSelectPromptConfig<T extends EditableMultiSelectRow> = {
  message: string;
  rows: T[];
  initialQuery?: string;
  cancelMessage?: string;
  requiresVersionConstraint: (row: T) => boolean;
  resolveItems: (
    rows: T[],
    query: string,
  ) => {
    filtered: T[];
    navigable: T[];
  };
  renderBrowse: (args: {
    prefix: string;
    styledMessage: string;
    query: string;
    rows: T[];
    filtered: T[];
    navigable: T[];
    activeRow: T | undefined;
    checkedCount: number;
  }) => string;
  renderShow: (row: T) => string;
  renderConstraint: (args: {
    prefix: string;
    styledMessage: string;
    target: T | undefined;
    constraintDraft: string;
    helpLine: string;
  }) => string;
};

const editableMultiSelectPromptBase = createPrompt<
  EditableMultiSelectPromptResult<EditableMultiSelectRow>,
  EditableMultiSelectPromptConfig<EditableMultiSelectRow>
>((config, done) => {
  const promptTheme = makeTheme(interactivePromptTheme, {});
  const prefix = usePrefix({ status: "idle", theme: promptTheme });
  const [rows, setRows] = useState(() => config.rows.map((row) => ({ ...row })));
  const [query, setQuery] = useState(config.initialQuery ?? "");
  const [active, setActive] = useState(0);
  const [view, setView] = useState<PromptView>("browse");
  const [showingRow, setShowingRow] = useState<EditableMultiSelectRow | null>(null);
  const [constraintDraft, setConstraintDraft] = useState("latest");
  const [constraintTargetId, setConstraintTargetId] = useState<string | null>(null);

  const { filtered, navigable } = config.resolveItems(rows, query);
  const clampedActive = clampActiveIndex(active, navigable.length);
  const activeRow = navigable[clampedActive];
  const styledMessage = promptTheme.style.message(config.message, "idle");

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

    if (
      handleShowViewEscape({
        view,
        setView,
        setShowingItem: setShowingRow,
        key,
      })
    ) {
      return;
    }

    if (isEscapeKey(key)) {
      throw new ExitPromptError(config.cancelMessage ?? "Selection cancelled");
    }

    if (key.ctrl && key.name === "s") {
      done({ rows });
      return;
    }

    if (isEnterKey(key)) {
      handleEnterToShow({
        item: activeRow,
        setView,
        setShowingItem: setShowingRow,
      });
      return;
    }

    if (
      handleNavigationKeypress({
        clampedActive,
        length: navigable.length,
        setActive,
        key,
      })
    ) {
      return;
    }

    if (navigable.length > 0 && isSpaceKey(key) && activeRow) {
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

      if (config.requiresVersionConstraint(activeRow)) {
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
      const visibleIds = new Set(navigable.map((row) => row.id));
      setRows(
        rows.map((row) =>
          visibleIds.has(row.id)
            ? {
                ...row,
                checked: true,
                version_constraint: config.requiresVersionConstraint(row)
                  ? row.version_constraint ?? "latest"
                  : row.version_constraint,
              }
            : row,
        ),
      );
      return;
    }

    if (key.ctrl && key.name === "x") {
      const visibleIds = new Set(navigable.map((row) => row.id));
      setRows(
        rows.map((row) =>
          visibleIds.has(row.id)
            ? { ...row, checked: false, version_constraint: undefined }
            : row,
        ),
      );
      return;
    }

    handleSearchKeypress({ query, setQuery, setActive, key });
  });

  if (view === "constraint" && constraintTargetId) {
    const target = rows.find((row) => row.id === constraintTargetId);
    const helpLine = buildHelpLine([
      ["type", "constraint"],
      ["⏎", "confirm"],
      ["esc", "cancel"],
    ]);
    return config.renderConstraint({
      prefix,
      styledMessage: promptTheme.style.message(
        `Version constraint for ${(target as { display_name?: string } | undefined)?.display_name ?? "attachment"}`,
        "idle",
      ),
      target,
      constraintDraft,
      helpLine,
    });
  }

  if (view === "show" && showingRow) {
    return config.renderShow(showingRow);
  }

  const checkedCount = rows.filter((row) => row.checked).length;
  return config.renderBrowse({
    prefix,
    styledMessage,
    query,
    rows,
    filtered,
    navigable,
    activeRow,
    checkedCount,
  });
});

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

export function createEditableMultiSelectPrompt<T extends EditableMultiSelectRow>(
  config: EditableMultiSelectPromptConfig<T>,
  context?: PromptContext,
): Promise<EditableMultiSelectPromptResult<T>> & { cancel: () => void } {
  return editableMultiSelectPromptBase(
    config as unknown as EditableMultiSelectPromptConfig<EditableMultiSelectRow>,
    context,
  ) as Promise<EditableMultiSelectPromptResult<T>> & { cancel: () => void };
}
