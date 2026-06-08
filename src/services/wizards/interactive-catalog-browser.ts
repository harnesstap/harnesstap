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
import type { CatalogLibrary } from "../catalog-types.js";
import {
  formatCatalogSelectionLabel,
  renderCatalogListTable,
} from "../../ui/catalog-list-render.js";
import { theme } from "../../ui/theme.js";

export type InteractiveCatalogBrowserResult = {
  orgSlug: string;
  slug: string;
  version: string | null;
};

type PromptConfig = {
  message: string;
  scopeLabel: string;
  listLibraries: (input: { q: string; limit: number }) => Promise<CatalogLibrary[]>;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

const interactiveCatalogBrowserTheme = {
  helpMode: "always",
  style: {
    keysHelpTip: (keys: Array<[string, string]>) =>
      keys.map(([key, action]) => `${key} ${action}`).join(" • "),
  },
};

function isSearchCharacter(key: {
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
}): key is { sequence: string } {
  return Boolean(
    key.sequence
      && key.sequence.length === 1
      && key.sequence.trim().length > 0
      && !key.ctrl
      && !key.meta,
  );
}

function isEscapeKey(key: { name?: string; sequence?: string }): boolean {
  return key.name === "escape" || key.sequence === "\u001b";
}

function clampActiveIndex(active: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  return Math.max(0, Math.min(active, length - 1));
}

export const promptForInteractiveCatalogBrowser: (
  config: PromptConfig,
  context?: PromptContext,
) => Promise<InteractiveCatalogBrowserResult> = createPrompt<
  InteractiveCatalogBrowserResult,
  PromptConfig
>((config, done) => {
  const promptTheme = makeTheme(interactiveCatalogBrowserTheme, {});
  const prefix = usePrefix({ status: "idle", theme: promptTheme });
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [libraries, setLibraries] = useState<CatalogLibrary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedQueryRef = { current: "__unset__" };
  const debounceRef = { current: null as ReturnType<typeof setTimeout> | null };
  const requestRef = { current: 0 };

  async function runSearch(nextQuery: string) {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const results = await config.listLibraries({
        q: nextQuery,
        limit: nextQuery.trim() ? 25 : 10,
      });
      if (requestId !== requestRef.current) {
        return;
      }
      setLibraries(results);
      fetchedQueryRef.current = nextQuery;
    } catch (searchError) {
      if (requestId !== requestRef.current) {
        return;
      }
      setLibraries([]);
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

  const clampedActive = clampActiveIndex(active, libraries.length);
  const selectedLibrary = libraries[clampedActive];

  useKeypress((key) => {
    if (isEscapeKey(key)) {
      throw new ExitPromptError("Catalog browse cancelled.");
    }

    if (isEnterKey(key)) {
      if (selectedLibrary) {
        done({
          orgSlug: selectedLibrary.orgSlug,
          slug: selectedLibrary.slug,
          version: selectedLibrary.latestVersion,
        });
      }
      return;
    }

    if (libraries.length > 0 && (isUpKey(key) || isDownKey(key))) {
      const direction = isUpKey(key) ? -1 : 1;
      setActive(clampActiveIndex(clampedActive + direction, libraries.length));
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

  const selectionLine = selectedLibrary
    ? `Install: ${theme.accent(`> ${formatCatalogSelectionLabel(selectedLibrary)}`)}`
    : theme.muted(loading ? "Loading libraries…" : "No matching libraries");

  const helpLine = promptTheme.style.keysHelpTip([
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
    error ? theme.danger(error) : renderCatalogListTable(libraries, {
      selectedSelector: selectedLibrary
        ? `${selectedLibrary.orgSlug}/${selectedLibrary.slug}`
        : undefined,
    }),
    "",
    helpLine,
  ].join("\n");
});

export async function runInteractiveCatalogBrowser(input: {
  message: string;
  scopeLabel: string;
  listLibraries: PromptConfig["listLibraries"];
}): Promise<InteractiveCatalogBrowserResult> {
  return promptForInteractiveCatalogBrowser(input);
}
