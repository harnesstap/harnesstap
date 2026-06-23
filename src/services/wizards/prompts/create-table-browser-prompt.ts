import {
  createPrompt,
  ExitPromptError,
  isBackspaceKey,
  isEnterKey,
  isSpaceKey,
  makeTheme,
  useEffect,
  useKeypress,
  usePrefix,
  useRef,
  useState,
} from "@inquirer/core";
import { createPromptScreen, type PromptScreen } from "../../../ui/prompt-screen.js";
import {
  computeShowViewportBounds,
  renderScrollableShowContent,
} from "../../../ui/show-viewport.js";
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
  isSearchCharacter,
  type InteractiveKeypress,
} from "./primitives.js";
import type {
  ManageAction,
  TableBrowserConfig,
  TableBrowserIntent,
  TableBrowserResult,
  ViewportRenderArgs,
} from "./table-browser-types.js";

type BrowseSubview = BrowseShowView | "confirm-delete" | "constraint";

function isLetterKey(key: InteractiveKeypress, letter: string): boolean {
  return (key.sequence === letter || key.name === letter) && !key.ctrl && !key.meta;
}

function isConfirmYes(key: InteractiveKeypress): boolean {
  return isLetterKey(key, "y") || isLetterKey(key, "Y");
}

function isConfirmNo(key: InteractiveKeypress): boolean {
  return isLetterKey(key, "n") || isLetterKey(key, "N") || isEscapeKey(key);
}

function usesCustomBrowseFrame(intent: TableBrowserIntent): boolean {
  switch (intent.kind) {
    case "pick-many":
    case "manage":
      return true;
    case "filter":
    case "pick-one":
    case "install":
      return false;
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
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

function resolveManageRowIndex<T>(sourceRows: T[] | undefined, item: T | undefined): number {
  if (!sourceRows || !item) {
    return -1;
  }
  return sourceRows.indexOf(item);
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
  const [showScrollOffset, setShowScrollOffset] = useState(0);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<unknown | null>(null);
  const [pickManyItems, setPickManyItems] = useState<unknown[]>(() =>
    config.pickManyItems
      ? config.pickManyItems.map((item) => ({ ...(item as object) }))
      : [],
  );
  const [constraintDraft, setConstraintDraft] = useState("latest");
  const [constraintTargetKey, setConstraintTargetKey] = useState<string | null>(null);
  const [pendingExitMessage, setPendingExitMessage] = useState<string | null>(null);
  const promptScreenRef = useRef<PromptScreen | null>(null);
  if (promptScreenRef.current === null) {
    promptScreenRef.current = createPromptScreen();
    promptScreenRef.current.enter();
  }
  const { width: terminalWidth, height: terminalRows } = useTerminalSize();

  useEffect(() => {
    return () => promptScreenRef.current?.exit();
  }, []);

  const isPickMany = config.intent.kind === "pick-many";
  const resolved = isPickMany
    ? (config.resolvePickManyItems?.(pickManyItems, query) ?? { filtered: [], navigable: [] })
    : config.adapter.resolveItems(query);
  const { filtered, navigable } = resolved;
  const clampedActive = clampActiveIndex(active, navigable.length);
  const selectedItem = navigable[clampedActive] as unknown | undefined;
  const styledMessage = promptTheme.style.message(config.message, "idle");
  const checkedCount = isPickMany
    ? pickManyItems.filter((item) => (item as { checked?: boolean }).checked).length
    : undefined;

  const viewportArgs: ViewportRenderArgs<unknown> = {
    query,
    filtered,
    navigable,
    active: clampedActive,
    selectedItem,
    terminalWidth,
    terminalRows,
    prefix,
    styledMessage,
    items: isPickMany ? pickManyItems : undefined,
    checkedCount,
  };

  const getItemKey = (item: unknown): string => {
    if (config.adapter.getItemKey) {
      return config.adapter.getItemKey(item);
    }
    return (item as { id: string }).id;
  };

  const commitPickMany = () => {
    const values = config.onCommitPickMany
      ? config.onCommitPickMany(pickManyItems as never[])
      : pickManyItems;
    done({ kind: "pick-many", values });
  };

  const commitConstraint = () => {
    if (!constraintTargetKey) {
      return;
    }
    const constraint = constraintDraft.trim() || "latest";
    setPickManyItems(
      pickManyItems.map((item) =>
        getItemKey(item) === constraintTargetKey
          ? { ...(item as object), checked: true, version_constraint: constraint }
          : item,
      ),
    );
    setConstraintTargetKey(null);
    setConstraintDraft("latest");
    setView("browse");
  };

  const finishManage = (action: ManageAction) => {
    done({ kind: "manage", action });
  };

  const enterShowView = (item: unknown | undefined | null) => {
    if (!item) {
      return;
    }
    setShowScrollOffset(0);
    handleEnterToShow({
      item,
      setView: (next) => setView(next),
      setShowingItem,
    });
  };

  useKeypress((key) => {
    if (view === "constraint") {
      if (isEscapeKey(key)) {
        setConstraintTargetKey(null);
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

    if (view === "confirm-delete") {
      if (isConfirmYes(key)) {
        const item = pendingDeleteItem;
        setPendingDeleteItem(null);
        if (
          item
          && (config.intent.kind === "filter" || config.intent.kind === "pick-one")
        ) {
          const value = config.adapter.onPick
            ? config.adapter.onPick(item)
            : item;
          done(
            config.intent.kind === "filter"
              ? { kind: "delete", value }
              : { kind: "pick-one", value },
          );
          return;
        }
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

    if (view === "show" && showingItem && config.adapter.renderShow) {
      if (
        handleShowViewEscape({
          view: "show",
          setView: (next) => {
            setView(next);
            if (next === "browse") {
              setShowScrollOffset(0);
            }
          },
          setShowingItem,
          key,
        })
      ) {
        return;
      }

      const showContent = config.adapter.renderShow(showingItem);
      const { maxScroll } = computeShowViewportBounds(
        showContent.split("\n").length,
        showScrollOffset,
        terminalRows,
      );
      if (
        handleNavigationKeypress({
          clampedActive: showScrollOffset,
          length: maxScroll + 1,
          setActive: setShowScrollOffset,
          key,
        })
      ) {
        return;
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
      if (config.intent.kind === "manage") {
        finishManage({ type: "cancel" });
        return;
      }
      setPendingExitMessage(config.cancelMessage ?? "Table browser cancelled.");
      return;
    }

    if (config.intent.kind === "manage") {
      if (isLetterKey(key, "q")) {
        finishManage({ type: "quit" });
        return;
      }
      if (isLetterKey(key, "a")) {
        finishManage({ type: "add" });
        return;
      }
      if (isLetterKey(key, "d") && selectedItem) {
        const rowIndex = resolveManageRowIndex(config.manageSourceRows, selectedItem);
        if (rowIndex >= 0) {
          finishManage({ type: "delete", rowIndex });
        }
        return;
      }
      if (isEnterKey(key) && selectedItem) {
        const rowIndex = resolveManageRowIndex(config.manageSourceRows, selectedItem);
        if (rowIndex >= 0) {
          finishManage({ type: "edit", rowIndex });
        }
        return;
      }
    }

    if (
      config.intent.kind === "filter"
      && key.ctrl
      && key.name === "e"
      && selectedItem
      && config.adapter.onEdit
    ) {
      done({ kind: "edit", value: config.adapter.onEdit(selectedItem) });
      return;
    }

    if (
      (config.intent.kind === "filter" || config.intent.kind === "pick-one")
      && key.ctrl
      && key.name === "x"
      && selectedItem
      && (config.adapter.onDelete || config.adapter.formatDeleteConfirm)
    ) {
      setPendingDeleteItem(selectedItem);
      setView("confirm-delete");
      return;
    }

    if (config.intent.kind === "pick-many") {
      if (key.ctrl && key.name === "s") {
        commitPickMany();
        return;
      }

      if (isEnterKey(key)) {
        if (config.adapter.renderShow) {
          enterShowView(selectedItem);
        }
        return;
      }

      if (navigable.length > 0 && isSpaceKey(key) && selectedItem) {
        const activeKey = getItemKey(selectedItem);
        const activeRow = pickManyItems.find((item) => getItemKey(item) === activeKey) as
          | { checked?: boolean; version_constraint?: string }
          | undefined;
        if (!activeRow) {
          return;
        }

        if (activeRow.checked) {
          setPickManyItems(
            pickManyItems.map((item) =>
              getItemKey(item) === activeKey
                ? { ...(item as object), checked: false, version_constraint: undefined }
                : item,
            ),
          );
          return;
        }

        if (config.requiresVersionConstraint?.(selectedItem)) {
          setConstraintTargetKey(activeKey);
          setConstraintDraft("latest");
          setView("constraint");
          return;
        }

        setPickManyItems(
          pickManyItems.map((item) =>
            getItemKey(item) === activeKey ? { ...(item as object), checked: true } : item,
          ),
        );
        return;
      }

      if (key.ctrl && key.name === "a") {
        const visibleKeys = new Set(navigable.map((item) => getItemKey(item)));
        setPickManyItems(
          pickManyItems.map((item) => {
            if (!visibleKeys.has(getItemKey(item))) {
              return item;
            }
            const row = item as { version_constraint?: string };
            return {
              ...(item as object),
              checked: true,
              version_constraint: config.requiresVersionConstraint?.(item)
                ? row.version_constraint ?? "latest"
                : row.version_constraint,
            };
          }),
        );
        return;
      }

      if (key.ctrl && key.name === "x") {
        const visibleKeys = new Set(navigable.map((item) => getItemKey(item)));
        setPickManyItems(
          pickManyItems.map((item) =>
            visibleKeys.has(getItemKey(item))
              ? { ...(item as object), checked: false, version_constraint: undefined }
              : item,
          ),
        );
        return;
      }
    }

    if (isEnterKey(key)) {
      if (config.intent.kind === "pick-one" || config.intent.kind === "install") {
        if (!selectedItem) {
          return;
        }
        const value = config.adapter.onPick
          ? config.adapter.onPick(selectedItem)
          : selectedItem;
        if (config.intent.kind === "install") {
          done({ kind: "install", value });
          return;
        }
        done({ kind: "pick-one", value });
        return;
      }

      if (config.adapter.renderShow) {
        enterShowView(selectedItem);
      }
      return;
    }

    if (config.intent.kind === "install" && isLetterKey(key, "i") && selectedItem) {
      const value = config.adapter.onPick
        ? config.adapter.onPick(selectedItem)
        : selectedItem;
      done({ kind: "install", value });
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

  if (pendingExitMessage) {
    throw new ExitPromptError(pendingExitMessage);
  }

  if (view === "show" && showingItem && config.adapter.renderShow) {
    const showContent = config.adapter.renderShow(showingItem);
    const helpLine = buildHelpLine([["↑↓", "scroll"], ["esc", "back"]]);
    return [
      renderScrollableShowContent(
        showContent,
        showScrollOffset,
        terminalRows,
        terminalWidth,
      ),
      "",
      helpLine,
    ].join("\n");
  }

  if (view === "constraint" && constraintTargetKey && config.renderConstraint) {
    const target = pickManyItems.find((item) => getItemKey(item) === constraintTargetKey);
    const constraintMessage = promptTheme.style.message(
      `Version constraint for ${(target as { display_name?: string } | undefined)?.display_name ?? "attachment"}`,
      "idle",
    );
    const helpLine = buildHelpLine([
      ["type", "constraint"],
      ["⏎", "confirm"],
      ["esc", "cancel"],
    ]);
    return config.renderConstraint({
      prefix,
      styledMessage: constraintMessage,
      target,
      constraintDraft,
      helpLine,
    });
  }

  const body = config.adapter.renderViewport(viewportArgs);

  if (view === "confirm-delete" && pendingDeleteItem) {
    const label = config.adapter.formatDeleteConfirm
      ? config.adapter.formatDeleteConfirm(pendingDeleteItem)
      : "Delete selected item?";
    return [
      usesCustomBrowseFrame(config.intent)
        ? body
        : renderBrowseFrame({
            prefix,
            styledMessage,
            query,
            body,
            helpActions: config.adapter.helpActions,
          }),
      "",
      theme.danger(`${label} [y/N]`),
    ].join("\n");
  }

  if (usesCustomBrowseFrame(config.intent)) {
    return body;
  }

  return renderBrowseFrame({
    prefix,
    styledMessage,
    query,
    body,
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
