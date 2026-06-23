import {
  createPrompt,
  ExitPromptError,
  isEnterKey,
  makeTheme,
  useEffect,
  useKeypress,
  usePrefix,
  useRef,
  useState,
} from "@inquirer/core";
import { createPromptScreen, type PromptScreen } from "../../../ui/prompt-screen.js";
import { theme } from "../../../ui/theme.js";
import {
  handleEnterToShow,
  handleShowViewEscape,
  type BrowseShowView,
} from "./hooks/use-browse-show-view.js";
import { handleNavigationKeypress } from "./hooks/use-list-navigation.js";
import { handleSearchKeypress } from "./hooks/use-local-query-filter.js";
import { useTerminalSize } from "./hooks/use-terminal-size.js";
import {
  buildHelpLine,
  clampActiveIndex,
  interactivePromptTheme,
  isEscapeKey,
  type InteractiveKeypress,
} from "./primitives.js";
import type {
  TableBrowserConfig,
  TableBrowserResult,
  ViewportRenderArgs,
} from "./table-browser-types.js";

type BrowseSubview = BrowseShowView | "confirm-delete";

function isLetterKey(key: InteractiveKeypress, letter: string): boolean {
  return key.sequence === letter && !key.ctrl && !key.meta;
}

function isConfirmYes(key: InteractiveKeypress): boolean {
  return isLetterKey(key, "y") || isLetterKey(key, "Y");
}

function isConfirmNo(key: InteractiveKeypress): boolean {
  return isLetterKey(key, "n") || isLetterKey(key, "N") || isEscapeKey(key);
}

function renderBrowseFrame(args: {
  prefix: string;
  styledMessage: string;
  query: string;
  body: string;
  helpActions: Array<[string, string]>;
}): string {
  return [
    `${args.prefix} ${args.styledMessage}`,
    `${theme.label("Search:")} ${args.query ? theme.entity(args.query) : theme.muted("(type to filter)")}`,
    "",
    args.body,
    "",
    buildHelpLine(args.helpActions),
  ].join("\n");
}

const tableBrowserPromptBase = createPrompt<
  TableBrowserResult<unknown>,
  TableBrowserConfig<unknown, unknown>
>((config, done) => {
  const promptTheme = makeTheme(interactivePromptTheme, {});
  const prefix = usePrefix({ status: "idle", theme: promptTheme });
  const [query, setQuery] = useState(config.initialQuery ?? "");
  const [active, setActive] = useState(0);
  const [view, setView] = useState<BrowseSubview>("browse");
  const [showingItem, setShowingItem] = useState<unknown | null>(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<unknown | null>(null);
  const promptScreenRef = useRef<PromptScreen | null>(null);
  if (promptScreenRef.current === null) {
    promptScreenRef.current = createPromptScreen();
    promptScreenRef.current.enter();
  }
  const { width: terminalWidth, height: terminalRows } = useTerminalSize();

  useEffect(() => {
    return () => promptScreenRef.current?.exit();
  }, []);

  const { filtered, navigable } = config.adapter.resolveItems(query);
  const clampedActive = clampActiveIndex(active, navigable.length);
  const selectedItem = navigable[clampedActive] as unknown | undefined;
  const styledMessage = promptTheme.style.message(config.message, "idle");

  const viewportArgs: ViewportRenderArgs<unknown> = {
    query,
    filtered,
    navigable,
    active: clampedActive,
    selectedItem,
    terminalWidth,
    terminalRows,
  };

  useKeypress((key) => {
    if (view === "confirm-delete") {
      if (isConfirmYes(key)) {
        const item = pendingDeleteItem;
        setPendingDeleteItem(null);
        setView("browse");
        if (item && config.adapter.onDelete) {
          void config.adapter.onDelete(item).then(() => undefined);
        }
      } else if (isConfirmNo(key)) {
        setPendingDeleteItem(null);
        setView("browse");
      }
      return;
    }

    if (
      handleShowViewEscape({
        view: view === "show" ? "show" : "browse",
        setView: (next) => setView(next),
        setShowingItem,
        key,
      })
    ) {
      return;
    }

    if (isEscapeKey(key)) {
      if (config.intent.kind === "filter") {
        done({ kind: "filter", query: query.trim() });
        return;
      }
      throw new ExitPromptError("Table browser cancelled.");
    }

    if (isLetterKey(key, "d") && selectedItem && config.adapter.onDelete) {
      setPendingDeleteItem(selectedItem);
      setView("confirm-delete");
      return;
    }

    if (isEnterKey(key)) {
      if (config.intent.kind === "pick-one") {
        if (!selectedItem) {
          return;
        }
        if (config.adapter.onPick) {
          done({ kind: "pick-one", value: config.adapter.onPick(selectedItem) });
          return;
        }
        done({ kind: "pick-one", value: selectedItem });
        return;
      }

      handleEnterToShow({
        item: selectedItem,
        setView: (next) => setView(next),
        setShowingItem,
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

    handleSearchKeypress({ query, setQuery, setActive, key });
  });

  if (view === "show" && showingItem && config.adapter.renderShow) {
    const helpLine = buildHelpLine([["esc", "back"]]);
    return [config.adapter.renderShow(showingItem), "", helpLine].join("\n");
  }

  if (view === "confirm-delete" && pendingDeleteItem) {
    const label = config.adapter.formatDeleteConfirm
      ? config.adapter.formatDeleteConfirm(pendingDeleteItem)
      : "Delete selected item?";
    return [
      renderBrowseFrame({
        prefix,
        styledMessage,
        query,
        body: config.adapter.renderViewport(viewportArgs),
        helpActions: config.adapter.helpActions,
      }),
      "",
      theme.danger(`${label} [y/N]`),
    ].join("\n");
  }

  return renderBrowseFrame({
    prefix,
    styledMessage,
    query,
    body: config.adapter.renderViewport(viewportArgs),
    helpActions: config.adapter.helpActions,
  });
});

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

export function createTableBrowserPrompt<T, TResult>(
  config: TableBrowserConfig<T, TResult>,
  context?: PromptContext,
): Promise<TableBrowserResult<TResult>> & { cancel: () => void } {
  return tableBrowserPromptBase(
    config as TableBrowserConfig<unknown, unknown>,
    context,
  ) as Promise<TableBrowserResult<TResult>> & { cancel: () => void };
}
