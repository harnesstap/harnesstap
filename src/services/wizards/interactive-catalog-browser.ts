import {
  createPrompt,
  ExitPromptError,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isUpKey,
  makeTheme,
  useKeypress,
  usePrefix,
  useState,
} from "@inquirer/core";
import type { CatalogLayer } from "../catalog-types.js";
import {
  formatCanonicalPublishedSelectorWithVersion,
} from "../layer-selector.js";
import {
  formatCatalogSelectionLabel,
  renderCatalogListTable,
} from "../../ui/catalog-list-render.js";
import { theme } from "../../ui/theme.js";
import {
  buildHelpLine,
  clampActiveIndex,
  interactivePromptTheme,
  isEscapeKey,
  isSearchCharacter,
} from "./prompts/primitives.js";

export type InteractiveCatalogBrowserResult = {
  orgSlug: string;
  catalogSlug: string;
  slug: string;
  version: string | null;
  selector: string;
};

type PromptConfig = {
  message: string;
  scopeLabel: string;
  listLayers: (input: { q: string; limit: number }) => Promise<CatalogLayer[]>;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

export const promptForInteractiveCatalogBrowser: (
  config: PromptConfig,
  context?: PromptContext,
) => Promise<InteractiveCatalogBrowserResult> = createPrompt<
  InteractiveCatalogBrowserResult,
  PromptConfig
>((config, done) => {
  const promptTheme = makeTheme(interactivePromptTheme, {});
  const prefix = usePrefix({ status: "idle", theme: promptTheme });
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [layers, setLayers] = useState<CatalogLayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedQueryRef = useState({ current: "__unset__" })[0];
  const debounceRef = useState<{ current: ReturnType<typeof setTimeout> | null }>({ current: null })[0];
  const requestRef = useState({ current: 0 })[0];

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
      fetchedQueryRef.current = nextQuery;
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

  if (fetchedQueryRef.current === "__unset__") {
    fetchedQueryRef.current = "";
    void runSearch("");
  }

  const clampedActive = clampActiveIndex(active, layers.length);
  const selectedLayer = layers[clampedActive];

  useKeypress((key) => {
    if (isEscapeKey(key)) {
      throw new ExitPromptError("Catalog browse cancelled.");
    }

    if (isEnterKey(key)) {
      if (selectedLayer) {
        done({
          orgSlug: selectedLayer.orgSlug,
          catalogSlug: selectedLayer.catalogSlug,
          slug: selectedLayer.slug,
          version: selectedLayer.latestVersion,
          selector: formatCanonicalPublishedSelectorWithVersion({
            org: selectedLayer.orgSlug,
            catalog: selectedLayer.catalogSlug,
            name: selectedLayer.slug,
            version: selectedLayer.latestVersion ?? undefined,
          }),
        });
      }
      return;
    }

    if (layers.length > 0 && (isUpKey(key) || isDownKey(key))) {
      const direction = isUpKey(key) ? -1 : 1;
      setActive(clampActiveIndex(clampedActive + direction, layers.length));
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

  const selectionLine = selectedLayer
    ? `Install: ${theme.accent(`> ${formatCatalogSelectionLabel(selectedLayer)}`)}`
    : theme.muted(loading ? "Loading layers…" : "No matching layers");

  const helpLine = buildHelpLine([
    ["↑↓", "select"],
    ["type", "search"],
    ["⌫", "erase"],
    ["⏎", "install"],
    ["esc", "cancel"],
  ]);

  return [
    `${prefix} ${promptTheme.style.message(config.message, "idle")}`,
    theme.muted(`Catalog: ${config.scopeLabel}`),
    `Search: ${query || "(type to filter)"}`,
    selectionLine,
    "",
    error ? theme.danger(error) : renderCatalogListTable(layers, {
      selectedSelector: selectedLayer
        ? formatCatalogSelectionLabel(selectedLayer)
        : undefined,
    }),
    "",
    helpLine,
  ].join("\n");
});

export async function runInteractiveCatalogBrowser(input: {
  message: string;
  scopeLabel: string;
  listLayers: PromptConfig["listLayers"];
}): Promise<InteractiveCatalogBrowserResult> {
  return promptForInteractiveCatalogBrowser(input);
}
