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
import type { CatalogLayer } from "../../catalog-types.js";
import { formatCanonicalPublishedSelectorWithVersion } from "../../layer-selector.js";
import {
  catalogLayerKey,
  formatCatalogSelectionLabel,
  renderCatalogLayerShow,
  renderCatalogListViewport,
  renderCatalogSearchViewport,
} from "../../../ui/catalog-list-render.js";
import { theme } from "../../../ui/theme.js";
import {
  buildHelpLine,
  clampActiveIndex,
  interactivePromptTheme,
  isEscapeKey,
  isSearchCharacter,
} from "./primitives.js";
import { useDebouncedRemoteSearch } from "./hooks/use-debounced-remote-search.js";
import { useTerminalSize } from "./hooks/use-terminal-size.js";
import type {
  RemoteCatalogListApplyResult,
  RemoteCatalogListConfig,
  RemoteCatalogListInstallResult,
  RemoteCatalogListResult,
  RemoteCatalogListSelection,
} from "./types.js";

type PromptView = "browse" | "show";

function toSelection(layer: CatalogLayer): RemoteCatalogListSelection {
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

export const createRemoteCatalogListPrompt: (
  config: RemoteCatalogListConfig,
  context?: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    clearPromptOnDone?: boolean;
    signal?: AbortSignal;
  },
) => Promise<RemoteCatalogListResult> = createPrompt<
  RemoteCatalogListResult,
  RemoteCatalogListConfig
>((config, done) => {
  const isApplyMode = config.mode.kind === "apply";
  const promptTheme = makeTheme(interactivePromptTheme, {});
  const prefix = usePrefix({ status: "idle", theme: promptTheme });
  const [query, setQuery] = useState(config.initialQuery ?? "");
  const [active, setActive] = useState(0);
  const [checkedLayers, setCheckedLayers] = useState<Map<string, CatalogLayer>>(
    () => new Map(),
  );
  const [view, setView] = useState<PromptView>("browse");
  const [showingLayer, setShowingLayer] = useState<CatalogLayer | null>(null);
  const { width: terminalWidth, height: terminalRows } = useTerminalSize();
  const { items: layers, loading, error, scheduleSearch } = useDebouncedRemoteSearch({
    initialQuery: config.initialQuery,
    limitFor: (nextQuery) => (nextQuery.trim() ? 25 : 10),
    searchFn: (nextQuery, limit) => config.listLayers({ q: nextQuery, limit }),
  });

  const clampedActive = clampActiveIndex(active, layers.length);
  const activeLayer = layers[clampedActive];
  const activeLayerKey = activeLayer ? catalogLayerKey(activeLayer) : undefined;

  function toggleLayer(layer: CatalogLayer) {
    const key = catalogLayerKey(layer);
    const next = new Map(checkedLayers);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.set(key, layer);
    }
    setCheckedLayers(next);
  }

  function selectVisibleLayers() {
    const next = new Map(checkedLayers);
    for (const layer of layers) {
      next.set(catalogLayerKey(layer), layer);
    }
    setCheckedLayers(next);
  }

  function clearVisibleLayers() {
    const next = new Map(checkedLayers);
    for (const layer of layers) {
      next.delete(catalogLayerKey(layer));
    }
    setCheckedLayers(next);
  }

  function finishInstall(layer: CatalogLayer) {
    const result: RemoteCatalogListInstallResult = toSelection(layer);
    done(result);
  }

  function finishApply() {
    const result: RemoteCatalogListApplyResult = {
      selections: [...checkedLayers.values()].map(toSelection),
    };
    done(result);
  }

  useKeypress((key) => {
    if (isApplyMode && view === "show") {
      if (isEscapeKey(key)) {
        setView("browse");
        setShowingLayer(null);
      }
      return;
    }

    if (isEscapeKey(key)) {
      throw new ExitPromptError(
        isApplyMode ? "Catalog search cancelled." : "Catalog browse cancelled.",
      );
    }

    if (isApplyMode && key.ctrl && key.name === "s") {
      if (checkedLayers.size > 0) {
        finishApply();
      }
      return;
    }

    if (isEnterKey(key)) {
      if (!activeLayer) {
        return;
      }
      if (isApplyMode) {
        setShowingLayer(activeLayer);
        setView("show");
      } else {
        finishInstall(activeLayer);
      }
      return;
    }

    if (layers.length > 0 && (isUpKey(key) || isDownKey(key))) {
      const direction = isUpKey(key) ? -1 : 1;
      setActive(clampActiveIndex(clampedActive + direction, layers.length));
      return;
    }

    if (isApplyMode && layers.length > 0 && isSpaceKey(key) && activeLayer) {
      toggleLayer(activeLayer);
      return;
    }

    if (isApplyMode && key.ctrl && key.name === "a") {
      selectVisibleLayers();
      return;
    }

    if (isApplyMode && key.ctrl && key.name === "x") {
      clearVisibleLayers();
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

  if (isApplyMode && view === "show" && showingLayer) {
    const helpLine = buildHelpLine([["esc", "back"]]);
    return [renderCatalogLayerShow(showingLayer), "", helpLine].join("\n");
  }

  const selectionLine = activeLayer
    ? isApplyMode
      ? `Active: ${theme.accent(formatCatalogSelectionLabel(activeLayer))}`
      : `Install: ${theme.accent(`> ${formatCatalogSelectionLabel(activeLayer)}`)}`
    : theme.muted(loading ? "Loading layers…" : "No matching layers");

  const helpLine = isApplyMode
    ? buildHelpLine([
        ["↑↓", "navigate"],
        ["space", "toggle"],
        ["type", "search"],
        ["⌫", "erase"],
        ["⏎", "show"],
        ["ctrl+s", "apply"],
        ["esc", "cancel"],
        ["ctrl+a", "all"],
        ["ctrl+x", "none"],
      ])
    : buildHelpLine([
        ["↑↓", "select"],
        ["type", "search"],
        ["⌫", "erase"],
        ["⏎", "install"],
        ["esc", "cancel"],
      ]);

  const tableSection = error
    ? theme.danger(error)
    : isApplyMode
      ? renderCatalogSearchViewport(layers, new Set(checkedLayers.keys()), {
          activeLayerKey,
          activeIndex: clampedActive,
          terminalRows,
          maxWidth: terminalWidth,
        })
      : renderCatalogListViewport(layers, {
          activeIndex: clampedActive,
          terminalRows,
          maxWidth: terminalWidth,
          selectedSelector: activeLayer
            ? formatCatalogSelectionLabel(activeLayer)
            : undefined,
        });

  return [
    `${prefix} ${promptTheme.style.message(config.message, "idle")}`,
    theme.muted(`Catalog: ${config.scopeLabel}`),
    ...(isApplyMode
      ? [theme.muted("Apply writes harness files — choose project or global scope after selecting")]
      : []),
    `Search: ${query || "(type to filter)"}`,
    ...(isApplyMode ? [`Selected: ${checkedLayers.size} to apply`] : []),
    selectionLine,
    "",
    tableSection,
    "",
    helpLine,
  ].join("\n");
});
