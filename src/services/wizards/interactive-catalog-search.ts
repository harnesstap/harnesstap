import {
  createPrompt,
  ExitPromptError,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isSpaceKey,
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
import {
  catalogLayerKey,
  formatCatalogSelectionLabel,
  renderCatalogLayerShow,
  renderCatalogSearchTable,
} from "../../ui/catalog-list-render.js";
import { theme } from "../../ui/theme.js";
import {
  buildHelpLine,
  clampActiveIndex,
  interactivePromptTheme,
  isEscapeKey,
  isSearchCharacter,
} from "./prompts/primitives.js";

export type InteractiveCatalogSearchSelection = {
  orgSlug: string;
  catalogSlug: string;
  slug: string;
  version: string | null;
  selector: string;
};

export type InteractiveCatalogSearchResult = {
  selections: InteractiveCatalogSearchSelection[];
};

type PromptView = "browse" | "show";

type PromptConfig = {
  message: string;
  scopeLabel: string;
  initialQuery?: string;
  listLayers: (input: { q: string; limit: number }) => Promise<CatalogLayer[]>;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

function toSelection(layer: CatalogLayer): InteractiveCatalogSearchSelection {
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

export const promptForInteractiveCatalogSearch: (
  config: PromptConfig,
  context?: PromptContext,
) => Promise<InteractiveCatalogSearchResult> = createPrompt<
  InteractiveCatalogSearchResult,
  PromptConfig
>((config, done) => {
  const promptTheme = makeTheme(interactivePromptTheme, {});
  const prefix = usePrefix({ status: "idle", theme: promptTheme });
  const [query, setQuery] = useState(config.initialQuery ?? "");
  const [active, setActive] = useState(0);
  const [layers, setLayers] = useState<CatalogLayer[]>([]);
  const [checkedLayers, setCheckedLayers] = useState<Map<string, CatalogLayer>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<PromptView>("browse");
  const [showingLayer, setShowingLayer] = useState<CatalogLayer | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);

  async function runSearch(nextQuery: string) {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const results = await config.listLayers({
        q: nextQuery,
        limit: nextQuery.trim() ? 25 : 10,
      });
      if (requestId !== requestRef.current) {
        return;
      }
      setLayers(results);
    } catch (searchError) {
      if (requestId !== requestRef.current) {
        return;
      }
      setLayers([]);
      setError(searchError instanceof Error ? searchError.message : String(searchError));
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
      }
    }
  }

  function scheduleSearch(nextQuery: string) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(nextQuery);
    }, 300);
  }

  useEffect(() => {
    void runSearch(config.initialQuery ?? "");
    return () => {
      requestRef.current += 1;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, []);

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

  function finishApply() {
    done({
      selections: [...checkedLayers.values()].map(toSelection),
    });
  }

  useKeypress((key) => {
    if (view === "show") {
      if (isEscapeKey(key)) {
        setView("browse");
        setShowingLayer(null);
      }
      return;
    }

    if (isEscapeKey(key)) {
      throw new ExitPromptError("Catalog search cancelled.");
    }

    if (key.ctrl && key.name === "s") {
      if (checkedLayers.size > 0) {
        finishApply();
      }
      return;
    }

    if (isEnterKey(key)) {
      if (activeLayer) {
        setShowingLayer(activeLayer);
        setView("show");
      }
      return;
    }

    if (layers.length > 0 && (isUpKey(key) || isDownKey(key))) {
      const direction = isUpKey(key) ? -1 : 1;
      setActive(clampActiveIndex(clampedActive + direction, layers.length));
      return;
    }

    if (layers.length > 0 && isSpaceKey(key) && activeLayer) {
      toggleLayer(activeLayer);
      return;
    }

    if (key.ctrl && key.name === "a") {
      selectVisibleLayers();
      return;
    }

    if (key.ctrl && key.name === "x") {
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

  if (view === "show" && showingLayer) {
    const helpLine = buildHelpLine([["esc", "back"]]);
    return [renderCatalogLayerShow(showingLayer), "", helpLine].join("\n");
  }

  const selectionLine = activeLayer
    ? `Active: ${theme.accent(formatCatalogSelectionLabel(activeLayer))}`
    : theme.muted(loading ? "Loading layers…" : "No matching layers");

  const helpLine = buildHelpLine([
    ["↑↓", "navigate"],
    ["space", "toggle"],
    ["type", "search"],
    ["⌫", "erase"],
    ["⏎", "show"],
    ["ctrl+s", "apply"],
    ["esc", "cancel"],
    ["ctrl+a", "all"],
    ["ctrl+x", "none"],
  ]);

  return [
    `${prefix} ${promptTheme.style.message(config.message, "idle")}`,
    theme.muted(`Catalog: ${config.scopeLabel}`),
    theme.muted("Apply writes harness files — choose project or global scope after selecting"),
    `Search: ${query || "(type to filter)"}`,
    `Selected: ${checkedLayers.size} to apply`,
    selectionLine,
    "",
    error
      ? theme.danger(error)
      : renderCatalogSearchTable(layers, new Set(checkedLayers.keys()), { activeLayerKey }),
    "",
    helpLine,
  ].join("\n");
});

export async function runInteractiveCatalogSearch(input: {
  message: string;
  scopeLabel: string;
  initialQuery?: string;
  listLayers: PromptConfig["listLayers"];
}): Promise<InteractiveCatalogSearchResult> {
  return promptForInteractiveCatalogSearch(input);
}
