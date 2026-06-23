import {
  createPrompt,
  isEnterKey,
  makeTheme,
  useKeypress,
  usePrefix,
  useState,
} from "@inquirer/core";
import { handleNavigationKeypress } from "./hooks/use-list-navigation.js";
import { handleSearchKeypress } from "./hooks/use-local-query-filter.js";
import { useTerminalSize } from "./hooks/use-terminal-size.js";
import {
  clampActiveIndex,
  interactivePromptTheme,
  isEscapeKey,
} from "./primitives.js";

export type ActionListPromptAction =
  | { type: "quit" }
  | { type: "cancel" }
  | { type: "edit"; rowIndex: number }
  | { type: "add" }
  | { type: "delete"; rowIndex: number };

export type ActionListPromptConfig<T> = {
  message: string;
  rows: T[];
  initialQuery?: string;
  filterRows: (rows: T[], query: string) => T[];
  renderBrowse: (args: {
    prefix: string;
    styledMessage: string;
    query: string;
    filteredRows: T[];
    activeRow: T | undefined;
    active: number;
    terminalWidth: number;
    terminalRows: number;
  }) => string;
};

function isLetterKey(
  key: { sequence?: string; ctrl?: boolean; meta?: boolean },
  letter: string,
): boolean {
  return key.sequence === letter && !key.ctrl && !key.meta;
}

const actionListPromptBase = createPrompt<
  ActionListPromptAction,
  ActionListPromptConfig<unknown>
>((config, done) => {
  const promptTheme = makeTheme(interactivePromptTheme, {});
  const prefix = usePrefix({ status: "idle", theme: promptTheme });
  const [query, setQuery] = useState(config.initialQuery ?? "");
  const [active, setActive] = useState(0);
  const { width: terminalWidth, height: terminalRows } = useTerminalSize();

  const filteredRows = config.filterRows(config.rows, query);
  const clampedActive = clampActiveIndex(active, filteredRows.length);
  const activeRow = filteredRows[clampedActive] as unknown | undefined;
  const styledMessage = promptTheme.style.message(config.message, "idle");

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

    if (
      handleNavigationKeypress({
        clampedActive,
        length: filteredRows.length,
        setActive,
        key,
      })
    ) {
      return;
    }

    handleSearchKeypress({ query, setQuery, setActive, key });
  });

  return config.renderBrowse({
    prefix,
    styledMessage,
    query,
    filteredRows: filteredRows as unknown[],
    activeRow,
    active: clampedActive,
    terminalWidth,
    terminalRows,
  });
});

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

export function createActionListPrompt<T>(
  config: ActionListPromptConfig<T>,
  context?: PromptContext,
): Promise<ActionListPromptAction> & { cancel: () => void } {
  return actionListPromptBase(config as ActionListPromptConfig<unknown>, context);
}
