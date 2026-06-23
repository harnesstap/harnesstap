import { basename } from "node:path";
import {
  formatCatalogScopeLabel,
  loadRegisteredCatalogs,
  resolveCatalogScope,
} from "../config/catalog.js";
import { listLayers } from "../models/layer-model.js";
import type { Layer } from "../types.js";
import { parseOutputFormat, printJson } from "../utils/output-format.js";
import { renderCatalogListChunk } from "../ui/catalog-list-render.js";
import { formatLocalLayerListName } from "../ui/layer-list-render.js";
import type { Column } from "../ui/table.js";
import { ui } from "../ui/index.js";
import { renderWarn } from "../ui/status.js";
import { catalogAliasHint } from "./catalog-aliases.js";
import { listLayersInScope } from "./catalog-client.js";
import { renderCatalogLayerPreviewShow } from "./catalog-layer-preview.js";
import { rankCatalogSearchResults } from "./catalog-search-rank.js";
import {
  buildCatalogListSources,
  listCatalogLayersFromSources,
  streamCatalogLayers,
} from "./catalog-list-stream.js";
import type { CatalogLayer } from "./catalog-types.js";
import {
  applyLayersGlobally,
  catalogSearchSelectors,
  promptCatalogSearchApplyScope,
} from "./layer-search-apply.js";
import {
  promptMaterializationConflict,
  resolveApplyConflictPolicy,
} from "./materialization-conflicts.js";
import { getActiveProfileName } from "./active-profile.js";
import { runInteractiveLayerListBrowse as promptInteractiveLayerListBrowse } from "./wizards/interactive-layer-list-browse.js";
import type { InteractiveLayerListBrowseSelection } from "./wizards/interactive-layer-list-browse.js";
import { runInteractiveCatalogSearch } from "./wizards/interactive-catalog-search.js";
import { shouldUseWizard, isPromptCancellationError } from "./wizards/shared.js";

export interface LayerListInstallContext {
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

export interface HandleLayerListCommandOpts {
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
  localLayersProvider?: () => Layer[];
  installOnSelect?: boolean;
  installContext?: LayerListInstallContext;
}

export type LayerListInteractiveDeps = {
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
    opts: LayerListInstallContext & { version?: string },
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
    catalogLayer: CatalogLayer,
    selection: InteractiveLayerListBrowseSelection,
    opts: { account?: string; baseUrl?: string; format?: string },
  ) => Promise<void>;
  onDeleteRemote: (
    catalogLayer: CatalogLayer,
    opts: { account?: string; baseUrl?: string; format?: string },
  ) => Promise<void>;
};

let interactiveDeps: LayerListInteractiveDeps | null = null;

export function configureLayerListInteractiveDeps(deps: LayerListInteractiveDeps): void {
  interactiveDeps = deps;
}

let layerSearchDeprecationWarned = false;
let layerPullBrowseDeprecationWarned = false;
let profileSearchDeprecationWarned = false;

export function warnLayerSearchDeprecated(): void {
  if (layerSearchDeprecationWarned) {
    return;
  }
  layerSearchDeprecationWarned = true;
  console.warn(
    renderWarn(
      `\`layer search\` is deprecated; use \`${formatCommand("layer list --search <query>")}\` instead`,
    ),
  );
}

export function warnLayerPullBrowseDeprecated(): void {
  if (layerPullBrowseDeprecationWarned) {
    return;
  }
  layerPullBrowseDeprecationWarned = true;
  console.warn(
    renderWarn(
      `\`layer pull\` without a selector is deprecated; use \`${formatCommand("layer list")}\` to browse and install`,
    ),
  );
}

export function warnProfileSearchDeprecated(): void {
  if (profileSearchDeprecationWarned) {
    return;
  }
  profileSearchDeprecationWarned = true;
  console.warn(
    renderWarn(
      `\`profile search\` is deprecated; use \`${formatCommand("profile list --search <query>")}\` instead`,
    ),
  );
}

function formatCommand(path: string): string {
  const invocation = basename(process.argv[1] ?? "") === "hd" ? "hd" : "harnessdeck";
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

export function filterLocalLayers(layers: Layer[], search?: string): Layer[] {
  const normalizedSearch = search?.trim().toLowerCase();
  if (!normalizedSearch) {
    return layers;
  }

  return layers.filter((layer) => {
    const haystack = [
      layer.name,
      layer.description,
      ...layer.tags,
    ].join(" ").toLowerCase();
    return haystack.includes(normalizedSearch);
  });
}

export function renderLocalLayerListTable(
  layers: Layer[],
  opts: { showId: boolean },
): string {
  return ui.table.render({
    columns: [
      ...makeIdColumn(opts.showId),
      { key: "name", header: "NAME", width: 26 },
      { key: "version", header: "VERSION", width: 12 },
      {
        key: "description",
        header: "DESCRIPTION",
        width: 44,
        transform: (value) => value || "—",
      },
    ],
    rows: layers.map((layer) => ({
      ...layer,
      name: formatLocalLayerListName(layer, { static: true }),
    })),
    summary: `${layers.length} layers ${ui.icons.bullet} run \`${formatCommand("layer show <name>")}\` for details`,
    empty: "No layers found.",
  });
}

function resolveLocalLayers(opts: HandleLayerListCommandOpts): Layer[] {
  const layers = opts.localLayersProvider?.() ?? listLayers();
  return filterLocalLayers(layers, opts.search);
}

function renderProfileLocalLayerListTable(layers: Layer[]): string {
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
    rows: layers.map((layer) => ({
      name: formatLocalLayerListName(layer, { static: true }),
      version: layer.version,
      active: activeProfile === layer.name ? "yes" : "",
      description: layer.description ?? "",
    })),
    empty: "No profile layers found.",
  });
}

function renderLocalLayerListSection(
  layers: Layer[],
  opts: HandleLayerListCommandOpts,
): string {
  if (opts.profileMode) {
    return renderProfileLocalLayerListTable(layers);
  }
  return renderLocalLayerListTable(layers, { showId: Boolean(opts.showId) });
}

function shouldUseInteractiveLayerListBrowse(opts: HandleLayerListCommandOpts): boolean {
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

async function listRemoteLayersForBrowse(
  opts: HandleLayerListCommandOpts,
  input: { q: string; limit: number },
): Promise<CatalogLayer[]> {
  const scope = resolveCatalogScope({ baseUrl: opts.baseUrl });
  const registered = loadRegisteredCatalogs();
  const sources = buildCatalogListSources({ scope, registered });
  const { layers } = await listCatalogLayersFromSources(sources, {
    q: input.q,
    tag: opts.tag,
    baseUrl: opts.baseUrl,
    limit: input.limit,
  });
  return input.q.trim()
    ? rankCatalogSearchResults(layers, input.q)
    : layers;
}

async function runInteractiveLayerListBrowse(opts: HandleLayerListCommandOpts): Promise<void> {
  const localLayers = resolveLocalLayers(opts);
  const scope = resolveCatalogScope({ baseUrl: opts.baseUrl });

  if (!interactiveDeps) {
    throw new Error("Interactive layer list is not configured");
  }

  try {
    while (true) {
      const result = await promptInteractiveLayerListBrowse({
        message: opts.profileMode
          ? "Select a profile layer"
          : "Select a layer",
        scopeLabel: formatCatalogScopeLabel(scope),
        localLayers,
        profileMode: opts.profileMode,
        showId: Boolean(opts.showId),
        listRemoteLayers: ({ q, limit }) => listRemoteLayersForBrowse(opts, { q, limit }),
        fetchRemoteLayerShow: (layer) => renderCatalogLayerPreviewShow(layer, {
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
          const applied = await applyLayersGlobally(selectors, {
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
          localLayers.splice(0, localLayers.length, ...resolveLocalLayers(opts));
          continue;
        case "delete":
          await interactiveDeps.onDelete(result.name, { format: opts.format });
          localLayers.splice(0, localLayers.length, ...resolveLocalLayers(opts));
          continue;
        case "edit-remote":
          await interactiveDeps.onEditRemote(result.catalogLayer, result.selection, {
            account: opts.account,
            baseUrl: opts.baseUrl,
            format: opts.format,
          });
          localLayers.splice(0, localLayers.length, ...resolveLocalLayers(opts));
          continue;
        case "delete-remote":
          await interactiveDeps.onDeleteRemote(result.catalogLayer, {
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

function shouldUseInteractiveRemoteSearch(opts: HandleLayerListCommandOpts): boolean {
  return shouldUseWizard({
    interactive: opts.interactive ?? true,
    noInteractive: opts.noInteractive,
    format: opts.format ?? "human",
    missingRequiredArgs: false,
  });
}

async function runInteractiveRemoteLayerSearch(opts: HandleLayerListCommandOpts): Promise<void> {
  const query = opts.search?.trim();
  if (!query) {
    return;
  }

  const catalogOptions = { account: opts.account, baseUrl: opts.baseUrl };
  const scope = resolveCatalogScope({ baseUrl: opts.baseUrl });
  const result = await runInteractiveCatalogSearch({
    message: "Search catalog layers to apply",
    scopeLabel: formatCatalogScopeLabel(scope),
    initialQuery: query,
    listLayers: ({ q, limit }) =>
      listLayersInScope(
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
  const applied = await applyLayersGlobally(selectors, {
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
  layerCount: number;
  error: string | null;
};

async function collectRemoteLayers(opts: HandleLayerListCommandOpts): Promise<{
  remote: CatalogLayer[];
  sourceStats: SourceStat[];
  timedOut: boolean;
}> {
  const scope = resolveCatalogScope({ baseUrl: opts.baseUrl });
  const registered = loadRegisteredCatalogs();
  const sources = buildCatalogListSources({ scope, registered });
  const sourceStats = new Map<string, SourceStat>(
    sources.map((source) => [source.label, { label: source.label, layerCount: 0, error: null }]),
  );
  const remote: CatalogLayer[] = [];
  let timedOut = false;

  for await (const event of streamCatalogLayers(sources, {
    q: opts.search,
    tag: opts.tag,
    baseUrl: opts.baseUrl,
  })) {
    switch (event.type) {
      case "chunk": {
        for (const layer of event.chunk.layers) {
          remote.push(layer);
        }
        const stat = sourceStats.get(event.chunk.sourceLabel);
        if (stat) {
          stat.layerCount += event.chunk.layers.length;
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
            layerCount: 0,
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
  parts.push(`${remoteCount} remote layers across ${sourceCount} sources`);
  console.log("");
  ui.dim(parts.join(" · "));
}

export async function handleLayerListCommand(opts: HandleLayerListCommandOpts): Promise<void> {
  const format = opts.format ?? parseOutputFormat(undefined);
  const includeLocal = !opts.remoteOnly;
  const includeRemote = !opts.localOnly;

  if (shouldUseInteractiveLayerListBrowse({ ...opts, format })) {
    await runInteractiveLayerListBrowse({ ...opts, format });
    return;
  }

  if (
    includeRemote
    && !includeLocal
    && opts.search?.trim()
    && shouldUseInteractiveRemoteSearch(opts)
  ) {
    await runInteractiveRemoteLayerSearch(opts);
    return;
  }

  const localLayers = includeLocal ? resolveLocalLayers(opts) : [];
  const activeProfile = opts.profileMode ? getActiveProfileName() : null;

  if (format === "json") {
    if (opts.profileMode && opts.localOnly) {
      printJson({
        profiles: localLayers.map((profile) => ({
          ...profile,
          active: activeProfile === profile.name,
        })),
      });
      return;
    }

    if (opts.localOnly) {
      printJson(localLayers);
      return;
    }

    if (opts.remoteOnly) {
      const { remote } = await collectRemoteLayers(opts);
      printJson(remote);
      return;
    }

    if (!includeRemote) {
      printJson(localLayers);
      return;
    }

    const { remote, sourceStats, timedOut } = await collectRemoteLayers(opts);
    if (opts.profileMode) {
      printJson({
        profiles: localLayers.map((profile) => ({
          ...profile,
          active: activeProfile === profile.name,
        })),
        remote,
        sources: sourceStats.map((source) => ({
          label: source.label,
          layerCount: source.layerCount,
          error: source.error,
        })),
        timedOut,
      });
      return;
    }

    printJson({
      local: localLayers,
      remote,
      sources: sourceStats.map((source) => ({
        label: source.label,
        layerCount: source.layerCount,
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
        ? `Local profiles (${localLayers.length})`
        : `Local layers (${localLayers.length})`,
    );
    console.log(renderLocalLayerListSection(localLayers, opts));
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

    for await (const event of streamCatalogLayers(sources, {
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
          remoteCount += event.chunk.layers.length;
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
      const aliasHint = catalogAliasHint(opts.search.trim());
      if (aliasHint) {
        ui.hint(aliasHint);
      } else {
        ui.dim("No remote results.");
      }
    }

    printListSummaryFooter(localLayers.length, remoteCount, sourceCount, includeLocal, includeRemote);
  }
}
