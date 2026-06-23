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
import type { CatalogLayer } from "../catalog-types.js";
import { formatCanonicalPublishedSelectorWithVersion } from "../layer-selector.js";
import { getActiveProfileName } from "../active-profile.js";
import { renderCatalogLayerShow } from "../../ui/catalog-list-render.js";
import {
  filterLocalBrowseRows,
  listNavigableLayerListBrowseRows,
  renderGroupedLayerListBrowseViewport,
  toRemoteBrowseRows,
  type LayerListBrowseRow,
} from "../../ui/layer-list-render.js";
import { renderLayerListShow } from "../../services/layer-show-render.js";
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
import type { Layer } from "../../types.js";
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

export type InteractiveLayerListBrowseSelection = {
  orgSlug: string;
  catalogSlug: string;
  slug: string;
  version: string | null;
  selector: string;
};

export type InteractiveLayerListBrowseResult =
  | { action: "install"; selection: InteractiveLayerListBrowseSelection }
  | { action: "apply"; selection: InteractiveLayerListBrowseSelection }
  | { action: "edit"; name: string }
  | { action: "delete"; name: string };

type PromptView = "browse" | "show" | "confirm-delete";

type PromptConfig = {
  message: string;
  scopeLabel: string;
  localLayers: Layer[];
  profileMode?: boolean;
  showId?: boolean;
  listRemoteLayers: (input: { q: string; limit: number }) => Promise<CatalogLayer[]>;
  fetchRemoteLayerDetails?: (layer: CatalogLayer) => Promise<CatalogLayer>;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

function toBrowseSelection(layer: CatalogLayer): InteractiveLayerListBrowseSelection {
  return {
    orgSlug: layer.orgSlug,
    catalogSlug: layer.catalogSlug,
    slug: layer.slug,
    version: layer.latestVersion,
    selector: formatCanonicalPublishedSelectorWithVersion({
      org: layer.orgSlug,
      catalog: layer.catalogSlug,
      name: layer.slug,
      version: layer.latestVersion ?? undefined,
    }),
  };
}

function finishBrowseAction(
  done: (value: InteractiveLayerListBrowseResult) => void,
  action: "install" | "apply",
  layer: CatalogLayer,
): void {
  done({ action, selection: toBrowseSelection(layer) });
}

function isConfirmYes(key: Parameters<typeof isLetterKey>[0]): boolean {
  return isLetterKey(key, "y") || isLetterKey(key, "Y");
}

function isConfirmNo(key: Parameters<typeof isLetterKey>[0]): boolean {
  return isLetterKey(key, "n") || isLetterKey(key, "N") || isEscapeKey(key);
}

export const promptForInteractiveLayerListBrowse: (
  config: PromptConfig,
  context?: PromptContext,
) => Promise<InteractiveLayerListBrowseResult> = createPrompt<
  InteractiveLayerListBrowseResult,
  PromptConfig
>((config, done) => {
  const promptTheme = makeTheme(interactivePromptTheme, {});
  const prefix = usePrefix({ status: "idle", theme: promptTheme });
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [view, setView] = useState<PromptView>("browse");
  const [showingRow, setShowingRow] = useState<LayerListBrowseRow | null>(null);
  const [showScrollOffset, setShowScrollOffset] = useState(0);
  const [remoteDetails, setRemoteDetails] = useState<CatalogLayer | null>(null);
  const [remoteDetailsLoading, setRemoteDetailsLoading] = useState(false);
  const [remoteDetailsError, setRemoteDetailsError] = useState<string | null>(null);
  const [pendingDeleteRow, setPendingDeleteRow] = useState<LayerListBrowseRow | null>(null);
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
      setRemoteDetails(null);
      setRemoteDetailsLoading(false);
      setRemoteDetailsError(null);
      return;
    }

    const layer = showingRow.catalogLayer;
    setRemoteDetails(layer);
    if (!config.fetchRemoteLayerDetails) {
      setRemoteDetailsLoading(false);
      setRemoteDetailsError(null);
      return;
    }

    let cancelled = false;
    setRemoteDetailsLoading(true);
    setRemoteDetailsError(null);
    void config.fetchRemoteLayerDetails(layer).then(
      (fetched) => {
        if (cancelled) {
          return;
        }
        setRemoteDetails(fetched);
        setRemoteDetailsLoading(false);
      },
      (error: unknown) => {
        if (cancelled) {
          return;
        }
        setRemoteDetailsError(error instanceof Error ? error.message : String(error));
        setRemoteDetailsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [view, showingRow]);

  const localRows = filterLocalBrowseRows(config.localLayers, query);
  const { items: remoteLayers, loading, error, scheduleSearch } = useDebouncedRemoteSearch({
    limitFor: (nextQuery) =>
      computeRemoteListFetchLimit(terminalRows, VIEWPORT_CHROME_LINES.layerListBrowse, {
        search: Boolean(nextQuery.trim()),
      }),
    searchFn: (nextQuery, limit) => config.listRemoteLayers({ q: nextQuery, limit }),
  });
  const remoteRows = toRemoteBrowseRows(remoteLayers);
  const navigable = listNavigableLayerListBrowseRows(localRows, remoteRows);
  const clampedActive = clampActiveIndex(active, navigable.length);
  const activeRow = navigable[clampedActive];
  const activeProfileName = config.profileMode ? getActiveProfileName() : null;
  const styledMessage = promptTheme.style.message(config.message, "idle");

  function openShowView(row: LayerListBrowseRow): void {
    setShowScrollOffset(0);
    setShowingRow(row);
    setView("show");
  }

  function renderRemoteShowContent(layer: CatalogLayer): string {
    const sections = [
      remoteDetailsLoading ? theme.muted("Loading layer details…") : "",
      remoteDetailsError ? theme.danger(remoteDetailsError) : "",
      renderCatalogLayerShow(layer),
    ].filter((section) => section.length > 0);
    return sections.join("\n");
  }

  useKeypress((key) => {
    if (view === "confirm-delete") {
      if (isConfirmYes(key) && pendingDeleteRow?.section === "local") {
        done({ action: "delete", name: pendingDeleteRow.layer.name });
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
        const displayLayer = remoteDetails ?? showingRow.catalogLayer;
        if (isLetterKey(key, "i")) {
          finishBrowseAction(done, "install", displayLayer);
          return;
        }
        if (isLetterKey(key, "a")) {
          finishBrowseAction(done, "apply", displayLayer);
          return;
        }
      }

      if (showingRow.section === "local") {
        if (isLetterKey(key, "e")) {
          done({ action: "edit", name: showingRow.layer.name });
          return;
        }
        if (isLetterKey(key, "d")) {
          setPendingDeleteRow(showingRow);
          setView("confirm-delete");
          return;
        }
      }

      const showContent = showingRow.section === "local"
        ? renderLayerListShow(showingRow.layer, {
            showId: config.showId,
            profileExtras: config.profileMode && activeProfileName
              ? { active: activeProfileName === showingRow.layer.name }
              : undefined,
          })
        : renderRemoteShowContent(remoteDetails ?? showingRow.catalogLayer);
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
      setPendingExitMessage("Layer list cancelled.");
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
        done({ action: "edit", name: activeRow.layer.name });
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
    const showContent = renderLayerListShow(showingRow.layer, {
      showId: config.showId,
      profileExtras: config.profileMode && activeProfileName
        ? { active: activeProfileName === showingRow.layer.name }
        : undefined,
    });
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
    const showContent = renderRemoteShowContent(remoteDetails ?? showingRow.catalogLayer);
    const helpLine = buildHelpLine([
      ["↑↓", "scroll"],
      ["i", "install"],
      ["a", "apply"],
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

  const helpLine = buildHelpLine([
    ["↑↓", "select"],
    ["type", "search"],
    ["⌫", "erase"],
    ["⏎", "show"],
    ["ctrl+e", "edit local"],
    ["ctrl+x", "delete local"],
    ["esc", "cancel"],
  ]);

  const tableSection = error
    ? theme.danger(error)
    : loading && navigable.length === 0
      ? theme.muted("Loading layers…")
      : renderGroupedLayerListBrowseViewport({
        activeIndex: clampedActive,
        navigable,
        terminalRows,
        maxWidth: terminalWidth,
        showId: config.showId,
        profileMode: config.profileMode,
        activeProfileName,
        scopeLabel: config.scopeLabel,
        localLayers: config.localLayers,
      });

  if (view === "confirm-delete" && pendingDeleteRow?.section === "local") {
    return [
      `${prefix} ${styledMessage}`,
      `${theme.label("Search:")} ${query ? theme.entity(query) : theme.muted("(type to filter)")}`,
      "",
      tableSection,
      "",
      helpLine,
      "",
      theme.danger(`Delete layer "${pendingDeleteRow.layer.name}"? [y/N]`),
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

export async function runInteractiveLayerListBrowse(input: {
  message: string;
  scopeLabel: string;
  localLayers: Layer[];
  profileMode?: boolean;
  showId?: boolean;
  listRemoteLayers: PromptConfig["listRemoteLayers"];
  fetchRemoteLayerDetails?: PromptConfig["fetchRemoteLayerDetails"];
}): Promise<InteractiveLayerListBrowseResult> {
  return promptForInteractiveLayerListBrowse(input);
}
