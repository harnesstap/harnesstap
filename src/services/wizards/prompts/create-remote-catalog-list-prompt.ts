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
import type { CatalogPlugin } from "../../catalog-types.js";
import { formatCanonicalPublishedSelectorWithVersion } from "../../plugin-selector.js";
import {
  catalogPluginKey,
  renderCatalogPluginShow,
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

function toSelection(plugin: CatalogPlugin): RemoteCatalogListSelection {
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
  const [checkedPlugins, setCheckedPlugins] = useState<Map<string, CatalogPlugin>>(
    () => new Map(),
  );
  const [view, setView] = useState<PromptView>("browse");
  const [showingPlugin, setShowingPlugin] = useState<CatalogPlugin | null>(null);
  const [pendingExitMessage, setPendingExitMessage] = useState<string | null>(null);
  const { width: terminalWidth, height: terminalRows } = useTerminalSize();
  const { items: plugins, loading, error, scheduleSearch } = useDebouncedRemoteSearch({
    initialQuery: config.initialQuery,
    limitFor: (nextQuery) => (nextQuery.trim() ? 25 : 10),
    searchFn: (nextQuery, limit) => config.listPlugins({ q: nextQuery, limit }),
  });

  const clampedActive = clampActiveIndex(active, plugins.length);
  const activePlugin = plugins[clampedActive];
  const activePluginKey = activePlugin ? catalogPluginKey(activePlugin) : undefined;

  function togglePlugin(plugin: CatalogPlugin) {
    const key = catalogPluginKey(plugin);
    const next = new Map(checkedPlugins);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.set(key, plugin);
    }
    setCheckedPlugins(next);
  }

  function selectVisiblePlugins() {
    const next = new Map(checkedPlugins);
    for (const plugin of plugins) {
      next.set(catalogPluginKey(plugin), plugin);
    }
    setCheckedPlugins(next);
  }

  function clearVisiblePlugins() {
    const next = new Map(checkedPlugins);
    for (const plugin of plugins) {
      next.delete(catalogPluginKey(plugin));
    }
    setCheckedPlugins(next);
  }

  function finishInstall(plugin: CatalogPlugin) {
    const result: RemoteCatalogListInstallResult = toSelection(plugin);
    done(result);
  }

  function finishApply() {
    const result: RemoteCatalogListApplyResult = {
      selections: [...checkedPlugins.values()].map(toSelection),
    };
    done(result);
  }

  useKeypress((key) => {
    if (isApplyMode && view === "show") {
      if (isEscapeKey(key)) {
        setView("browse");
        setShowingPlugin(null);
      }
      return;
    }

    if (isEscapeKey(key)) {
      setPendingExitMessage(
        isApplyMode ? "Catalog search cancelled." : "Catalog browse cancelled.",
      );
      return;
    }

    if (isApplyMode && key.ctrl && key.name === "s") {
      if (checkedPlugins.size > 0) {
        finishApply();
      }
      return;
    }

    if (isEnterKey(key)) {
      if (!activePlugin) {
        return;
      }
      if (isApplyMode) {
        setShowingPlugin(activePlugin);
        setView("show");
      } else {
        finishInstall(activePlugin);
      }
      return;
    }

    if (plugins.length > 0 && (isUpKey(key) || isDownKey(key))) {
      const direction = isUpKey(key) ? -1 : 1;
      setActive(clampActiveIndex(clampedActive + direction, plugins.length));
      return;
    }

    if (isApplyMode && plugins.length > 0 && isSpaceKey(key) && activePlugin) {
      togglePlugin(activePlugin);
      return;
    }

    if (isApplyMode && key.ctrl && key.name === "a") {
      selectVisiblePlugins();
      return;
    }

    if (isApplyMode && key.ctrl && key.name === "x") {
      clearVisiblePlugins();
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

  if (isApplyMode && view === "show" && showingPlugin) {
    const helpLine = buildHelpLine([["esc", "back"]]);
    return [renderCatalogPluginShow(showingPlugin), "", helpLine].join("\n");
  }

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
      ? renderCatalogSearchViewport(plugins, new Set(checkedPlugins.keys()), {
          activePluginKey,
          activeIndex: clampedActive,
          terminalRows,
          maxWidth: terminalWidth,
        })
      : renderCatalogListViewport(plugins, {
          activeIndex: clampedActive,
          terminalRows,
          maxWidth: terminalWidth,
        });

  return [
    `${prefix} ${promptTheme.style.message(config.message, "idle")}`,
    theme.muted(`Catalog: ${config.scopeLabel}`),
    ...(isApplyMode
      ? [theme.muted("Apply writes harness files — choose project or global scope after selecting")]
      : []),
    `${theme.label("Search:")} ${query ? theme.entity(query) : theme.muted("(type to filter)")}`,
    ...(isApplyMode ? [`Selected: ${checkedPlugins.size} to apply`] : []),
    ...(loading && plugins.length === 0 ? [theme.muted("Loading plugins…")] : []),
    "",
    tableSection,
    "",
    helpLine,
  ].join("\n");
});
