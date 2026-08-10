import {
  createPrompt,
  ExitPromptError,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isUpKey,
  makeTheme,
  useEffect,
  useKeypress,
  usePrefix,
  useRef,
  useState,
} from "@inquirer/core";
import type { CatalogPlugin } from "../catalog-types.js";
import {
  formatCatalogPluginManageLabel,
  isCatalogPluginManageable,
} from "../catalog-plugin-manage.js";
import { formatCanonicalPublishedSelectorWithVersion } from "../plugin-selector.js";
import { getActiveProfileName } from "../active-profile.js";
import {
  filterLocalBrowseRows,
  listNavigablePluginListBrowseRows,
  renderGroupedPluginListBrowseViewport,
  toRemoteBrowseRows,
  type PluginListBrowseRow,
} from "../../ui/plugin-list-render.js";
import { renderPluginShowForPlugin } from "../../services/plugin-show-render.js";
import {
  computeShowViewportBounds,
  renderScrollableShowContent,
} from "../../ui/show-viewport.js";
import { createPromptScreen, type PromptScreen } from "../../ui/prompt-screen.js";
import {
  computeRemoteListFetchLimit,
  VIEWPORT_CHROME_LINES,
} from "../../ui/list-viewport.js";
import { theme } from "../../ui/theme.js";
import type { Plugin } from "../../types.js";
import {
  buildHelpLine,
  clampActiveIndex,
  interactivePromptTheme,
  isEscapeKey,
  isLetterKey,
  isSearchCharacter,
} from "./prompts/primitives.js";
import { handleNavigationKeypress } from "./prompts/hooks/use-list-navigation.js";
import { useDebouncedRemoteSearch } from "./prompts/hooks/use-debounced-remote-search.js";
import { useTerminalSize } from "./prompts/hooks/use-terminal-size.js";

export type InteractivePluginListBrowseSelection = {
  orgSlug: string;
  catalogSlug: string;
  slug: string;
  version: string | null;
  selector: string;
};

export type InteractivePluginListBrowseResult =
  | { action: "install"; selection: InteractivePluginListBrowseSelection }
  | { action: "apply"; selection: InteractivePluginListBrowseSelection }
  | { action: "edit"; name: string }
  | { action: "delete"; name: string }
  | { action: "edit-remote"; selection: InteractivePluginListBrowseSelection; catalogPlugin: CatalogPlugin }
  | { action: "delete-remote"; selection: InteractivePluginListBrowseSelection; catalogPlugin: CatalogPlugin };

type PromptView = "browse" | "show" | "confirm-delete";

type PromptConfig = {
  message: string;
  scopeLabel: string;
  localPlugins: Plugin[];
  profileMode?: boolean;
  showId?: boolean;
  listRemotePlugins: (input: { q: string; limit: number }) => Promise<CatalogPlugin[]>;
  fetchRemotePluginShow?: (plugin: CatalogPlugin) => Promise<string>;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

function toBrowseSelection(plugin: CatalogPlugin): InteractivePluginListBrowseSelection {
  return {
    orgSlug: plugin.orgSlug,
    catalogSlug: plugin.catalogSlug,
    slug: plugin.slug,
    version: plugin.latestVersion,
    selector: formatCanonicalPublishedSelectorWithVersion({
      org: plugin.orgSlug,
      catalog: plugin.catalogSlug,
      name: plugin.slug,
      version: plugin.latestVersion ?? undefined,
    }),
  };
}

function finishBrowseAction(
  done: (value: InteractivePluginListBrowseResult) => void,
  action: "install" | "apply",
  plugin: CatalogPlugin,
): void {
  done({ action, selection: toBrowseSelection(plugin) });
}

function isManageableRemoteRow(row: PluginListBrowseRow | null | undefined): row is Extract<
  PluginListBrowseRow,
  { section: "remote" }
> {
  return row?.section === "remote" && isCatalogPluginManageable(row.catalogPlugin);
}

function finishRemoteManageAction(
  done: (value: InteractivePluginListBrowseResult) => void,
  action: "edit-remote" | "delete-remote",
  plugin: CatalogPlugin,
): void {
  done({
    action,
    selection: toBrowseSelection(plugin),
    catalogPlugin: plugin,
  });
}

function formatPendingDeletePrompt(row: PluginListBrowseRow): string {
  if (row.section === "local") {
    return `Delete plugin "${row.plugin.name}"? [y/N]`;
  }
  return `Delete catalog plugin "${formatCatalogPluginManageLabel(row.catalogPlugin)}"? [y/N] (local install is kept)`;
}

function buildBrowseHelpLine(activeRow: PluginListBrowseRow | undefined): string {
  if (activeRow?.section === "remote" && isCatalogPluginManageable(activeRow.catalogPlugin)) {
    return buildHelpLine([
      ["↑↓", "select"],
      ["type", "search"],
      ["⌫", "erase"],
      ["⏎", "show"],
      ["ctrl+e", "edit catalog"],
      ["ctrl+x", "delete catalog"],
      ["esc", "cancel"],
    ]);
  }
  if (activeRow?.section === "local") {
    return buildHelpLine([
      ["↑↓", "select"],
      ["type", "search"],
      ["⌫", "erase"],
      ["⏎", "show"],
      ["ctrl+e", "edit local"],
      ["ctrl+x", "delete local"],
      ["esc", "cancel"],
    ]);
  }
  return buildHelpLine([
    ["↑↓", "select"],
    ["type", "search"],
    ["⌫", "erase"],
    ["⏎", "show"],
    ["esc", "cancel"],
  ]);
}

function isConfirmYes(key: Parameters<typeof isLetterKey>[0]): boolean {
  return isLetterKey(key, "y") || isLetterKey(key, "Y");
}

function isConfirmNo(key: Parameters<typeof isLetterKey>[0]): boolean {
  return isLetterKey(key, "n") || isLetterKey(key, "N") || isEscapeKey(key);
}

export const promptForInteractivePluginListBrowse: (
  config: PromptConfig,
  context?: PromptContext,
) => Promise<InteractivePluginListBrowseResult> = createPrompt<
  InteractivePluginListBrowseResult,
  PromptConfig
>((config, done) => {
  const promptTheme = makeTheme(interactivePromptTheme, {});
  const prefix = usePrefix({ status: "idle", theme: promptTheme });
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [view, setView] = useState<PromptView>("browse");
  const [showingRow, setShowingRow] = useState<PluginListBrowseRow | null>(null);
  const [showScrollOffset, setShowScrollOffset] = useState(0);
  const [remoteShowContent, setRemoteShowContent] = useState<string | null>(null);
  const [remoteShowLoading, setRemoteShowLoading] = useState(false);
  const [remoteShowError, setRemoteShowError] = useState<string | null>(null);
  const [pendingDeleteRow, setPendingDeleteRow] = useState<PluginListBrowseRow | null>(null);
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

  useEffect(() => {
    if (view !== "show" || showingRow?.section !== "remote") {
      setRemoteShowContent(null);
      setRemoteShowLoading(false);
      setRemoteShowError(null);
      return;
    }

    const plugin = showingRow.catalogPlugin;
    if (!config.fetchRemotePluginShow) {
      setRemoteShowContent(null);
      setRemoteShowLoading(false);
      setRemoteShowError(null);
      return;
    }

    let cancelled = false;
    setRemoteShowContent(null);
    setRemoteShowLoading(true);
    setRemoteShowError(null);
    void config.fetchRemotePluginShow(plugin).then(
      (content) => {
        if (cancelled) {
          return;
        }
        setRemoteShowContent(content);
        setRemoteShowLoading(false);
      },
      (error: unknown) => {
        if (cancelled) {
          return;
        }
        setRemoteShowError(error instanceof Error ? error.message : String(error));
        setRemoteShowLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [view, showingRow]);

  const localRows = filterLocalBrowseRows(config.localPlugins, query);
  const { items: remotePlugins, loading, error, scheduleSearch } = useDebouncedRemoteSearch({
    limitFor: (nextQuery) =>
      computeRemoteListFetchLimit(terminalRows, VIEWPORT_CHROME_LINES.pluginListBrowse, {
        search: Boolean(nextQuery.trim()),
      }),
    searchFn: (nextQuery, limit) => config.listRemotePlugins({ q: nextQuery, limit }),
  });
  const remoteRows = toRemoteBrowseRows(remotePlugins);
  const navigable = listNavigablePluginListBrowseRows(localRows, remoteRows);
  const clampedActive = clampActiveIndex(active, navigable.length);
  const activeRow = navigable[clampedActive];
  const activeProfileName = config.profileMode ? getActiveProfileName() : null;
  const styledMessage = promptTheme.style.message(config.message, "idle");

  function openShowView(row: PluginListBrowseRow): void {
    setShowScrollOffset(0);
    setShowingRow(row);
    setView("show");
  }

  function localPluginShowOptions(): Parameters<typeof renderPluginShowForPlugin>[1] {
    return {
      showId: config.showId,
      profileExtras: config.profileMode && activeProfileName && showingRow?.section === "local"
        ? { active: activeProfileName === showingRow.plugin.name }
        : undefined,
    };
  }

  function renderRemoteShowContent(): string {
    const sections = [
      remoteShowLoading ? theme.muted("Loading plugin details…") : "",
      remoteShowError && !remoteShowContent
        ? theme.danger(remoteShowError)
        : "",
      remoteShowContent ?? "",
    ].filter((section) => section.length > 0);
    return sections.join("\n");
  }

  useKeypress((key) => {
    if (view === "confirm-delete") {
      if (isConfirmYes(key) && pendingDeleteRow) {
        if (pendingDeleteRow.section === "local") {
          done({ action: "delete", name: pendingDeleteRow.plugin.name });
          return;
        }
        finishRemoteManageAction(done, "delete-remote", pendingDeleteRow.catalogPlugin);
        return;
      }
      if (isConfirmNo(key)) {
        setPendingDeleteRow(null);
        setView(showingRow ? "show" : "browse");
      }
      return;
    }

    if (view === "show" && showingRow) {
      if (isEscapeKey(key)) {
        setView("browse");
        setShowingRow(null);
        setShowScrollOffset(0);
        return;
      }

      if (showingRow.section === "remote") {
        const displayPlugin = showingRow.catalogPlugin;
        if (isLetterKey(key, "i")) {
          finishBrowseAction(done, "install", displayPlugin);
          return;
        }
        if (isLetterKey(key, "a")) {
          finishBrowseAction(done, "apply", displayPlugin);
          return;
        }
        if (isCatalogPluginManageable(displayPlugin) && isLetterKey(key, "e")) {
          finishRemoteManageAction(done, "edit-remote", displayPlugin);
          return;
        }
        if (isCatalogPluginManageable(displayPlugin) && isLetterKey(key, "d")) {
          setPendingDeleteRow(showingRow);
          setView("confirm-delete");
          return;
        }
      }

      if (showingRow.section === "local") {
        if (isLetterKey(key, "e")) {
          done({ action: "edit", name: showingRow.plugin.name });
          return;
        }
        if (isLetterKey(key, "d")) {
          setPendingDeleteRow(showingRow);
          setView("confirm-delete");
          return;
        }
      }

      const showContent = showingRow.section === "local"
        ? renderPluginShowForPlugin(showingRow.plugin, localPluginShowOptions())
        : renderRemoteShowContent();
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

    if (isEscapeKey(key)) {
      setPendingExitMessage("Plugin list cancelled.");
      return;
    }

    if (isEnterKey(key)) {
      if (!activeRow) {
        return;
      }
      openShowView(activeRow);
      return;
    }

    if (activeRow?.section === "local") {
      if (key.ctrl && key.name === "e") {
        done({ action: "edit", name: activeRow.plugin.name });
        return;
      }
      if (key.ctrl && key.name === "x") {
        setPendingDeleteRow(activeRow);
        setView("confirm-delete");
        return;
      }
    }

    if (isManageableRemoteRow(activeRow)) {
      if (key.ctrl && key.name === "e") {
        finishRemoteManageAction(done, "edit-remote", activeRow.catalogPlugin);
        return;
      }
      if (key.ctrl && key.name === "x") {
        setPendingDeleteRow(activeRow);
        setView("confirm-delete");
        return;
      }
    }

    if (navigable.length > 0 && (isUpKey(key) || isDownKey(key))) {
      const direction = isUpKey(key) ? -1 : 1;
      setActive(clampActiveIndex(clampedActive + direction, navigable.length));
      return;
    }

    if (isBackspaceKey(key)) {
      const nextQuery = query.slice(0, -1);
      setQuery(nextQuery);
      setActive(0);
      scheduleSearch(nextQuery);
      return;
    }

    if (isSearchCharacter(key)) {
      const nextQuery = query + key.sequence;
      setQuery(nextQuery);
      setActive(0);
      scheduleSearch(nextQuery);
    }
  });

  if (pendingExitMessage) {
    throw new ExitPromptError(pendingExitMessage);
  }

  if (view === "show" && showingRow?.section === "local") {
    const showContent = renderPluginShowForPlugin(showingRow.plugin, localPluginShowOptions());
    const helpLine = buildHelpLine([
      ["↑↓", "scroll"],
      ["e", "edit"],
      ["d", "delete"],
      ["esc", "back"],
    ]);
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

  if (view === "show" && showingRow?.section === "remote") {
    const displayPlugin = showingRow.catalogPlugin;
    const showContent = renderRemoteShowContent();
    const remoteHelp: Array<[string, string]> = [
      ["↑↓", "scroll"],
      ["i", "install"],
      ["a", "apply"],
    ];
    if (isCatalogPluginManageable(displayPlugin)) {
      remoteHelp.push(["e", "edit"], ["d", "delete"]);
    }
    remoteHelp.push(["esc", "back"]);
    const helpLine = buildHelpLine(remoteHelp);
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

  const helpLine = buildBrowseHelpLine(activeRow);

  const tableSection = error
    ? theme.danger(error)
    : loading && navigable.length === 0
      ? theme.muted("Loading plugins…")
      : renderGroupedPluginListBrowseViewport({
        activeIndex: clampedActive,
        navigable,
        terminalRows,
        maxWidth: terminalWidth,
        showId: config.showId,
        profileMode: config.profileMode,
        activeProfileName,
        scopeLabel: config.scopeLabel,
        localPlugins: config.localPlugins,
      });

  if (view === "confirm-delete" && pendingDeleteRow) {
    return [
      `${prefix} ${styledMessage}`,
      `${theme.label("Search:")} ${query ? theme.entity(query) : theme.muted("(type to filter)")}`,
      "",
      tableSection,
      "",
      helpLine,
      "",
      theme.danger(formatPendingDeletePrompt(pendingDeleteRow)),
    ].join("\n");
  }

  return [
    `${prefix} ${styledMessage}`,
    `${theme.label("Search:")} ${query ? theme.entity(query) : theme.muted("(type to filter)")}`,
    "",
    tableSection,
    "",
    helpLine,
  ].join("\n");
});

export async function runInteractivePluginListBrowse(input: {
  message: string;
  scopeLabel: string;
  localPlugins: Plugin[];
  profileMode?: boolean;
  showId?: boolean;
  listRemotePlugins: PromptConfig["listRemotePlugins"];
  fetchRemotePluginShow?: PromptConfig["fetchRemotePluginShow"];
}): Promise<InteractivePluginListBrowseResult> {
  return promptForInteractivePluginListBrowse(input);
}
