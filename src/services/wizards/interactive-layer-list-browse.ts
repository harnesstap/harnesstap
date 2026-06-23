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
  formatLayerListBrowseSelectionLabel,
  listNavigableLayerListBrowseRows,
  renderGroupedLayerListBrowseViewport,
  renderLocalLayerBrowseShow,
  toRemoteBrowseRows,
  type LayerListBrowseRow,
} from "../../ui/layer-list-render.js";
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
  isSearchCharacter,
} from "./prompts/primitives.js";
import { useDebouncedRemoteSearch } from "./prompts/hooks/use-debounced-remote-search.js";
import { useTerminalSize } from "./prompts/hooks/use-terminal-size.js";
import type { RemoteCatalogListInstallResult } from "./prompts/types.js";

type PromptView = "browse" | "show";

export type InteractiveLayerListBrowseResult = RemoteCatalogListInstallResult;

type PromptConfig = {
  message: string;
  scopeLabel: string;
  localLayers: Layer[];
  profileMode?: boolean;
  showId?: boolean;
  listRemoteLayers: (input: { q: string; limit: number }) => Promise<CatalogLayer[]>;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

function toInstallSelection(layer: CatalogLayer): InteractiveLayerListBrowseResult {
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
  const promptScreenRef = useRef<PromptScreen | null>(null);
  if (promptScreenRef.current === null) {
    promptScreenRef.current = createPromptScreen();
    promptScreenRef.current.enter();
  }
  const { width: terminalWidth, height: terminalRows } = useTerminalSize();

  useEffect(() => {
    return () => promptScreenRef.current?.exit();
  }, []);

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

  useKeypress((key) => {
    if (view === "show") {
      if (isEscapeKey(key)) {
        setView("browse");
        setShowingRow(null);
      }
      return;
    }

    if (isEscapeKey(key)) {
      throw new ExitPromptError("Layer list cancelled.");
    }

    if (isEnterKey(key)) {
      if (!activeRow) {
        return;
      }
      if (activeRow.section === "local") {
        setShowingRow(activeRow);
        setView("show");
        return;
      }
      done(toInstallSelection(activeRow.catalogLayer));
      return;
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

  if (view === "show" && showingRow?.section === "local") {
    const helpLine = buildHelpLine([["esc", "back"]]);
    return [
      renderLocalLayerBrowseShow(showingRow.layer, { activeProfileName }),
      "",
      helpLine,
    ].join("\n");
  }

  if (view === "show" && showingRow?.section === "remote") {
    const helpLine = buildHelpLine([["esc", "back"]]);
    return [renderCatalogLayerShow(showingRow.catalogLayer), "", helpLine].join("\n");
  }

  const selectionLine = activeRow
    ? activeRow.section === "local"
      ? `Local: ${theme.accent(`> ${formatLayerListBrowseSelectionLabel(activeRow)}`)}`
      : `Install: ${theme.accent(`> ${formatLayerListBrowseSelectionLabel(activeRow)}`)}`
    : theme.muted(loading ? "Loading layers…" : "No matching layers");

  const helpLine = buildHelpLine([
    ["↑↓", "select"],
    ["type", "search"],
    ["⌫", "erase"],
    ["⏎", "install/show"],
    ["esc", "cancel"],
  ]);

  const tableSection = error
    ? theme.danger(error)
    : renderGroupedLayerListBrowseViewport({
        activeIndex: clampedActive,
        navigable,
        terminalRows,
        maxWidth: terminalWidth,
        showId: config.showId,
        profileMode: config.profileMode,
        activeProfileName,
        scopeLabel: config.scopeLabel,
      });

  return [
    `${prefix} ${styledMessage}`,
    `${theme.label("Search:")} ${query ? theme.entity(query) : theme.muted("(type to filter)")}`,
    selectionLine,
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
}): Promise<InteractiveLayerListBrowseResult> {
  return promptForInteractiveLayerListBrowse(input);
}
