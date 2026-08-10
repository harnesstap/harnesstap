import { basename } from "node:path";
import {
  formatCatalogScopeLabel,
  loadRegisteredCatalogs,
  resolveCatalogScope,
} from "../config/catalog.js";
import { listPlugins } from "../models/plugin-model.js";
import { formatPluginVersionLabel } from "./plugin-versioning.js";
import type { Plugin } from "../types.js";
import { parseOutputFormat, printJson } from "../utils/output-format.js";
import { renderCatalogListChunk } from "../ui/catalog-list-render.js";
import { formatLocalPluginListName } from "../ui/plugin-list-render.js";
import type { Column } from "../ui/table.js";
import { ui } from "../ui/index.js";
import { listPluginsInScope } from "./catalog-client.js";
import { renderCatalogPluginPreviewShow } from "./catalog-plugin-preview.js";
import { rankCatalogSearchResults } from "./catalog-search-rank.js";
import {
  buildCatalogListSources,
  listCatalogPluginsFromSources,
  streamCatalogPlugins,
} from "./catalog-list-stream.js";
import type { CatalogPlugin } from "./catalog-types.js";
import {
  applyPluginsGlobally,
  catalogSearchSelectors,
  promptCatalogSearchApplyScope,
} from "./plugin-search-apply.js";
import {
  promptMaterializationConflict,
  resolveApplyConflictPolicy,
} from "./materialization-conflicts.js";
import { getActiveProfileName } from "./active-profile.js";
import { runInteractivePluginListBrowse as promptInteractivePluginListBrowse } from "./wizards/interactive-plugin-list-browse.js";
import type { InteractivePluginListBrowseSelection } from "./wizards/interactive-plugin-list-browse.js";
import { runInteractiveCatalogSearch } from "./wizards/interactive-catalog-search.js";
import { shouldUseWizard, isPromptCancellationError } from "./wizards/shared.js";

export interface PluginListInstallContext {
  as?: string;
  org?: string;
  catalog?: string;
  version?: string;
  account?: string;
  baseUrl?: string;
  format?: string;
  interactive?: boolean;
  noInteractive?: boolean;
}

export interface HandlePluginListCommandOpts {
  search?: string;
  localOnly?: boolean;
  remoteOnly?: boolean;
  tag?: string;
  showId?: boolean;
  format?: "human" | "json";
  account?: string;
  baseUrl?: string;
  noInteractive?: boolean;
  interactive?: boolean;
  profileMode?: boolean;
  localPluginsProvider?: () => Plugin[];
  installOnSelect?: boolean;
  installContext?: PluginListInstallContext;
}

export type PluginListInteractiveDeps = {
  applyToProject: (
    selectors: [string, ...string[]],
    opts: {
      account?: string;
      baseUrl?: string;
      format?: string;
      noInteractive?: boolean;
    },
  ) => Promise<void>;
  onInstall: (
    selector: string,
    opts: PluginListInstallContext & { version?: string },
  ) => Promise<void>;
  onEdit: (
    name: string,
    opts: { format?: string },
  ) => Promise<void>;
  onDelete: (
    name: string,
    opts: { format?: string },
  ) => Promise<void>;
  onEditRemote: (
    catalogPlugin: CatalogPlugin,
    selection: InteractivePluginListBrowseSelection,
    opts: { account?: string; baseUrl?: string; format?: string },
  ) => Promise<void>;
  onDeleteRemote: (
    catalogPlugin: CatalogPlugin,
    opts: { account?: string; baseUrl?: string; format?: string },
  ) => Promise<void>;
};

let interactiveDeps: PluginListInteractiveDeps | null = null;

export function configurePluginListInteractiveDeps(deps: PluginListInteractiveDeps): void {
  interactiveDeps = deps;
}

function formatCommand(path: string): string {
  const invocation = basename(process.argv[1] ?? "") === "ht" ? "ht" : "harnesstap";
  return `${invocation} ${path}`.trim();
}

function makeIdColumn(showId: boolean, width = 12): Column[] {
  return showId
    ? [{
        key: "id",
        header: "ID",
        width,
        transform: (value: string) => ui.format.shortenId(String(value)),
      }]
    : [];
}

export function filterLocalPlugins(plugins: Plugin[], search?: string): Plugin[] {
  const normalizedSearch = search?.trim().toLowerCase();
  if (!normalizedSearch) {
    return plugins;
  }

  return plugins.filter((plugin) => {
    const haystack = [
      plugin.name,
      plugin.description,
      ...plugin.tags,
    ].join(" ").toLowerCase();
    return haystack.includes(normalizedSearch);
  });
}

function formatOriginCell(origin: string): string {
  if (origin === "upstream" || origin === "catalog") {
    return ui.theme.muted(origin);
  }
  return origin || "authored";
}

export function renderLocalPluginListTable(
  plugins: Plugin[],
  opts: { showId: boolean },
): string {
  return ui.table.render({
    columns: [
      ...makeIdColumn(opts.showId),
      { key: "name", header: "NAME", width: 26 },
      {
        key: "origin",
        header: "ORIGIN",
        width: 12,
        style: (value) => formatOriginCell(String(value)),
      },
      { key: "version", header: "VERSION", width: 12 },
      {
        key: "description",
        header: "DESCRIPTION",
        width: 44,
        transform: (value) => value || "—",
      },
    ],
    rows: plugins.map((plugin) => ({
      ...(opts.showId ? { id: plugin.id } : {}),
      name: formatLocalPluginListName(plugin, { static: true }),
      origin: plugin.origin || "authored",
      version: formatPluginVersionLabel(plugin.version, plugin.dirty),
      description: plugin.description ?? "",
    })),
    summary: `${plugins.length} plugins ${ui.icons.bullet} run \`${formatCommand("plugin show <name>")}\` for details`,
    empty: "No plugins found.",
  });
}

function resolveLocalPlugins(opts: HandlePluginListCommandOpts): Plugin[] {
  const plugins = opts.localPluginsProvider?.() ?? listPlugins();
  return filterLocalPlugins(plugins, opts.search);
}

function renderProfileLocalPluginListTable(plugins: Plugin[]): string {
  const activeProfile = getActiveProfileName();
  return ui.table.render({
    columns: [
      { key: "name", header: "NAME", width: 24 },
      { key: "version", header: "VERSION", width: 12 },
      { key: "active", header: "ACTIVE", width: 8 },
      {
        key: "description",
        header: "DESCRIPTION",
        width: 50,
        transform: (value) => value || "—",
      },
    ],
    rows: plugins.map((plugin) => ({
      name: formatLocalPluginListName(plugin, { static: true }),
      version: formatPluginVersionLabel(plugin.version, plugin.dirty),
      active: activeProfile === plugin.name ? "yes" : "",
      description: plugin.description ?? "",
    })),
    empty: "No profile plugins found.",
  });
}

function renderLocalPluginListSection(
  plugins: Plugin[],
  opts: HandlePluginListCommandOpts,
): string {
  if (opts.profileMode) {
    return renderProfileLocalPluginListTable(plugins);
  }
  return renderLocalPluginListTable(plugins, { showId: Boolean(opts.showId) });
}

function shouldUseInteractivePluginListBrowse(opts: HandlePluginListCommandOpts): boolean {
  if (opts.localOnly || opts.remoteOnly) {
    return false;
  }
  if ((opts.format ?? "human") !== "human") {
    return false;
  }
  if (!shouldUseWizard({
    interactive: opts.interactive ?? true,
    noInteractive: opts.noInteractive,
    format: opts.format ?? "human",
    missingRequiredArgs: false,
  })) {
    return false;
  }
  if (opts.installOnSelect) {
    return true;
  }
  return !opts.search?.trim();
}

async function listRemotePluginsForBrowse(
  opts: HandlePluginListCommandOpts,
  input: { q: string; limit: number },
): Promise<CatalogPlugin[]> {
  const scope = resolveCatalogScope({ baseUrl: opts.baseUrl });
  const registered = loadRegisteredCatalogs();
  const sources = buildCatalogListSources({ scope, registered });
  const { plugins } = await listCatalogPluginsFromSources(sources, {
    q: input.q,
    tag: opts.tag,
    baseUrl: opts.baseUrl,
    limit: input.limit,
  });
  return input.q.trim()
    ? rankCatalogSearchResults(plugins, input.q)
    : plugins;
}

async function runInteractivePluginListBrowse(opts: HandlePluginListCommandOpts): Promise<void> {
  const localPlugins = resolveLocalPlugins(opts);
  const scope = resolveCatalogScope({ baseUrl: opts.baseUrl });

  if (!interactiveDeps) {
    throw new Error("Interactive plugin list is not configured");
  }

  try {
    while (true) {
      const result = await promptInteractivePluginListBrowse({
        message: opts.profileMode
          ? "Select a profile plugin"
          : "Select a plugin",
        scopeLabel: formatCatalogScopeLabel(scope),
        localPlugins,
        profileMode: opts.profileMode,
        showId: Boolean(opts.showId),
        listRemotePlugins: ({ q, limit }) => listRemotePluginsForBrowse(opts, { q, limit }),
        fetchRemotePluginShow: (plugin) => renderCatalogPluginPreviewShow(plugin, {
          account: opts.account,
          baseUrl: opts.baseUrl,
          showId: Boolean(opts.showId),
        }),
      });

      switch (result.action) {
        case "install":
          await interactiveDeps.onInstall(result.selection.selector, {
            ...opts.installContext,
            account: opts.account ?? opts.installContext?.account,
            baseUrl: opts.baseUrl ?? opts.installContext?.baseUrl,
            format: opts.format ?? opts.installContext?.format,
            noInteractive: opts.noInteractive ?? opts.installContext?.noInteractive,
            interactive: opts.interactive ?? opts.installContext?.interactive,
            version: opts.installContext?.version,
          });
          return;
        case "apply": {
          const selectors = [result.selection.selector] as [string, ...string[]];
          const applyScope = await promptCatalogSearchApplyScope();
          const onFetched = (sourceLabel: string) => {
            ui.info(`Fetched ${sourceLabel} from catalog`);
          };

          if (applyScope === "project") {
            await interactiveDeps.applyToProject(selectors, {
              account: opts.account,
              baseUrl: opts.baseUrl,
              format: opts.format,
              noInteractive: opts.noInteractive,
            });
            return;
          }

          const conflictPolicy = resolveApplyConflictPolicy({
            noInteractive: opts.noInteractive,
          });
          const conflictResolver =
            conflictPolicy === "prompt" ? promptMaterializationConflict : undefined;
          const applied = await applyPluginsGlobally(selectors, {
            account: opts.account,
            baseUrl: opts.baseUrl,
            conflictPolicy,
            conflictResolver,
            onFetched,
          });
          if (applied.cancelled) {
            process.exitCode = 1;
            ui.danger("Apply cancelled due to file conflicts");
          }
          return;
        }
        case "edit":
          await interactiveDeps.onEdit(result.name, { format: opts.format });
          localPlugins.splice(0, localPlugins.length, ...resolveLocalPlugins(opts));
          continue;
        case "delete":
          await interactiveDeps.onDelete(result.name, { format: opts.format });
          localPlugins.splice(0, localPlugins.length, ...resolveLocalPlugins(opts));
          continue;
        case "edit-remote":
          await interactiveDeps.onEditRemote(result.catalogPlugin, result.selection, {
            account: opts.account,
            baseUrl: opts.baseUrl,
            format: opts.format,
          });
          localPlugins.splice(0, localPlugins.length, ...resolveLocalPlugins(opts));
          continue;
        case "delete-remote":
          await interactiveDeps.onDeleteRemote(result.catalogPlugin, {
            account: opts.account,
            baseUrl: opts.baseUrl,
            format: opts.format,
          });
          continue;
        default: {
          const _exhaustive: never = result;
          throw _exhaustive;
        }
      }
    }
  } catch (error) {
    if (isPromptCancellationError(error)) {
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

function shouldUseInteractiveRemoteSearch(opts: HandlePluginListCommandOpts): boolean {
  return shouldUseWizard({
    interactive: opts.interactive ?? true,
    noInteractive: opts.noInteractive,
    format: opts.format ?? "human",
    missingRequiredArgs: false,
  });
}

async function runInteractiveRemotePluginSearch(opts: HandlePluginListCommandOpts): Promise<void> {
  const query = opts.search?.trim();
  if (!query) {
    return;
  }

  const catalogOptions = { account: opts.account, baseUrl: opts.baseUrl };
  const scope = resolveCatalogScope({ baseUrl: opts.baseUrl });
  const result = await runInteractiveCatalogSearch({
    message: "Search catalog plugins to apply",
    scopeLabel: formatCatalogScopeLabel(scope),
    initialQuery: query,
    listPlugins: ({ q, limit }) =>
      listPluginsInScope(
        { q, tag: opts.tag, limit, sort: "updated" },
        catalogOptions,
      ),
  });

  if (result.selections.length === 0) {
    return;
  }

  const selectors = catalogSearchSelectors(result.selections);
  const applyScope = await promptCatalogSearchApplyScope();
  const onFetched = (sourceLabel: string) => {
    ui.info(`Fetched ${sourceLabel} from catalog`);
  };

  if (applyScope === "project") {
    if (!interactiveDeps) {
      throw new Error("Interactive project apply is not configured");
    }
    await interactiveDeps.applyToProject(selectors, {
      account: opts.account,
      baseUrl: opts.baseUrl,
      format: opts.format,
      noInteractive: opts.noInteractive,
    });
    return;
  }

  const conflictPolicy = resolveApplyConflictPolicy({
    noInteractive: opts.noInteractive,
  });
  const conflictResolver =
    conflictPolicy === "prompt" ? promptMaterializationConflict : undefined;
  const applied = await applyPluginsGlobally(selectors, {
    account: opts.account,
    baseUrl: opts.baseUrl,
    conflictPolicy,
    conflictResolver,
    onFetched,
  });
  if (applied.cancelled) {
    process.exitCode = 1;
    ui.danger("Apply cancelled due to file conflicts");
  }
}

type SourceStat = {
  label: string;
  pluginCount: number;
  error: string | null;
};

async function collectRemotePlugins(opts: HandlePluginListCommandOpts): Promise<{
  remote: CatalogPlugin[];
  sourceStats: SourceStat[];
  timedOut: boolean;
}> {
  const scope = resolveCatalogScope({ baseUrl: opts.baseUrl });
  const registered = loadRegisteredCatalogs();
  const sources = buildCatalogListSources({ scope, registered });
  const sourceStats = new Map<string, SourceStat>(
    sources.map((source) => [source.label, { label: source.label, pluginCount: 0, error: null }]),
  );
  const remote: CatalogPlugin[] = [];
  let timedOut = false;

  for await (const event of streamCatalogPlugins(sources, {
    q: opts.search,
    tag: opts.tag,
    baseUrl: opts.baseUrl,
  })) {
    switch (event.type) {
      case "chunk": {
        for (const plugin of event.chunk.plugins) {
          remote.push(plugin);
        }
        const stat = sourceStats.get(event.chunk.sourceLabel);
        if (stat) {
          stat.pluginCount += event.chunk.plugins.length;
        }
        break;
      }
      case "error": {
        const stat = sourceStats.get(event.sourceLabel);
        if (stat) {
          stat.error = event.message;
        } else {
          sourceStats.set(event.sourceLabel, {
            label: event.sourceLabel,
            pluginCount: 0,
            error: event.message,
          });
        }
        break;
      }
      case "done":
        timedOut = event.timedOut;
        break;
      default: {
        const neverEvent: never = event;
        throw new Error(`Unhandled catalog stream event: ${String(neverEvent)}`);
      }
    }
  }

  const orderedRemote = opts.search?.trim()
    ? rankCatalogSearchResults(remote, opts.search)
    : remote;

  return {
    remote: orderedRemote,
    sourceStats: [...sourceStats.values()],
    timedOut,
  };
}

function printListSummaryFooter(
  localCount: number,
  remoteCount: number,
  sourceCount: number,
  includeLocal: boolean,
  includeRemote: boolean,
): void {
  if (!includeRemote) {
    return;
  }

  const parts: string[] = [];
  if (includeLocal) {
    parts.push(`${localCount} local`);
  }
  parts.push(`${remoteCount} remote plugins across ${sourceCount} sources`);
  console.log("");
  ui.dim(parts.join(" · "));
}

export async function handlePluginListCommand(opts: HandlePluginListCommandOpts): Promise<void> {
  const format = opts.format ?? parseOutputFormat(undefined);
  const includeLocal = !opts.remoteOnly;
  const includeRemote = !opts.localOnly;

  if (shouldUseInteractivePluginListBrowse({ ...opts, format })) {
    await runInteractivePluginListBrowse({ ...opts, format });
    return;
  }

  if (
    includeRemote
    && !includeLocal
    && opts.search?.trim()
    && shouldUseInteractiveRemoteSearch(opts)
  ) {
    await runInteractiveRemotePluginSearch(opts);
    return;
  }

  const localPlugins = includeLocal ? resolveLocalPlugins(opts) : [];
  const activeProfile = opts.profileMode ? getActiveProfileName() : null;

  if (format === "json") {
    if (opts.profileMode && opts.localOnly) {
      printJson({
        profiles: localPlugins.map((profile) => ({
          ...profile,
          active: activeProfile === profile.name,
        })),
      });
      return;
    }

    if (opts.localOnly) {
      printJson(localPlugins);
      return;
    }

    if (opts.remoteOnly) {
      const { remote } = await collectRemotePlugins(opts);
      printJson(remote);
      return;
    }

    if (!includeRemote) {
      printJson(localPlugins);
      return;
    }

    const { remote, sourceStats, timedOut } = await collectRemotePlugins(opts);
    if (opts.profileMode) {
      printJson({
        profiles: localPlugins.map((profile) => ({
          ...profile,
          active: activeProfile === profile.name,
        })),
        remote,
        sources: sourceStats.map((source) => ({
          label: source.label,
          pluginCount: source.pluginCount,
          error: source.error,
        })),
        timedOut,
      });
      return;
    }

    printJson({
      local: localPlugins,
      remote,
      sources: sourceStats.map((source) => ({
        label: source.label,
        pluginCount: source.pluginCount,
        error: source.error,
      })),
      timedOut,
    });
    return;
  }

  let remoteCount = 0;
  let sourceCount = 0;

  if (includeLocal) {
    ui.header(
      opts.profileMode
        ? `Local profiles (${localPlugins.length})`
        : `Local plugins (${localPlugins.length})`,
    );
    console.log(renderLocalPluginListSection(localPlugins, opts));
    if (includeRemote) {
      console.log("");
    }
  }

  if (includeRemote) {
    const scope = resolveCatalogScope({ baseUrl: opts.baseUrl });
    const registered = loadRegisteredCatalogs();
    const sources = buildCatalogListSources({ scope, registered });
    sourceCount = sources.length;
    let timedOut = false;

    for await (const event of streamCatalogPlugins(sources, {
      q: opts.search,
      tag: opts.tag,
      baseUrl: opts.baseUrl,
    })) {
      switch (event.type) {
        case "chunk": {
          const rendered = renderCatalogListChunk(event.chunk);
          if (rendered) {
            console.log(rendered);
            console.log("");
          }
          remoteCount += event.chunk.plugins.length;
          break;
        }
        case "error":
          ui.warn(`${event.sourceLabel}: ${event.message}`);
          break;
        case "done":
          timedOut = event.timedOut;
          break;
        default: {
          const neverEvent: never = event;
          throw new Error(`Unhandled catalog stream event: ${String(neverEvent)}`);
        }
      }
    }

    if (timedOut) {
      ui.warn("Remote listing stopped after 30s (partial results shown)");
    }

    if (
      opts.remoteOnly
      && opts.search?.trim()
      && remoteCount === 0
    ) {
      ui.dim("No remote results.");
    }

    printListSummaryFooter(localPlugins.length, remoteCount, sourceCount, includeLocal, includeRemote);
  }
}
