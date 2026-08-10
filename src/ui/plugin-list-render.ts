import semver from "semver";
import type { CatalogPlugin } from "../services/catalog-types.js";
import { formatPluginVersionLabel } from "../services/plugin-versioning.js";
import { isProfilePlugin } from "../constants/profile.js";
import type { Plugin } from "../types.js";
import * as format from "./format.js";
import {
  catalogPluginKey,
  formatCatalogScopePath,
  formatCatalogSelectionLabel,
} from "./catalog-list-render.js";
import { formatVersionWithDrift } from "./version-render.js";
import {
  computeMaxVisibleTableRows,
  renderFoldedHintLine,
  resolveSectionViewport,
  VIEWPORT_CHROME_LINES,
  type SectionViewport,
} from "./list-viewport.js";
import { matchesListSearchQuery, parseListSearchQuery } from "./list-search.js";
import { renderTable, type Column } from "./table.js";
import { icons, terminalColumns, theme } from "./theme.js";

export function formatLocalPluginListName(
  plugin: Pick<Plugin, "name" | "tags">,
  opts?: { selected?: boolean; static?: boolean },
): string {
  const kind = isProfilePlugin(plugin)
    ? `${theme.accent(icons.profile)} `
    : opts?.static
      ? ""
      : "  ";
  if (opts?.static) {
    return `${kind}${plugin.name}`;
  }
  const cursor = opts?.selected ? ">" : " ";
  return `${cursor}${kind}${plugin.name}`;
}

export function formatCatalogPluginListSlug(
  plugin: Pick<CatalogPlugin, "slug" | "tags">,
  opts?: { selected?: boolean },
): string {
  const slug = isProfilePlugin(plugin)
    ? `${theme.accent(icons.profile)} ${plugin.slug}`
    : plugin.slug;
  if (opts?.selected) {
    return `> ${slug}`;
  }
  return opts === undefined ? slug : `  ${slug}`;
}

export function formatCatalogPluginListName(plugin: Pick<CatalogPlugin, "name" | "tags">): string {
  if (!isProfilePlugin(plugin)) {
    return plugin.name;
  }
  return `${theme.accent(icons.profile)} ${plugin.name}`;
}

export function formatCatalogPluginListSelector(
  plugin: CatalogPlugin,
  opts?: { selected?: boolean },
): string {
  const listDisplayName = formatCatalogSelectionLabel(plugin);
  if (!isProfilePlugin(plugin)) {
    return opts?.selected ? `> ${listDisplayName}` : listDisplayName;
  }
  const marked = `${theme.accent(icons.profile)} ${listDisplayName}`;
  return opts?.selected ? `> ${marked}` : marked;
}

export const PLUGIN_LIST_SECTIONS = ["local", "remote"] as const;
export type PluginListSection = (typeof PLUGIN_LIST_SECTIONS)[number];

export type PluginListBrowseRow =
  | { section: "local"; plugin: Plugin }
  | { section: "remote"; catalogPlugin: CatalogPlugin };

export function pluginListBrowseRowKey(row: PluginListBrowseRow): string {
  return row.section === "local"
    ? `local:${row.plugin.id}`
    : `remote:${catalogPluginKey(row.catalogPlugin)}`;
}

export function toLocalBrowseRows(plugins: Plugin[]): PluginListBrowseRow[] {
  return plugins.map((plugin) => ({ section: "local", plugin }));
}

export function toRemoteBrowseRows(plugins: CatalogPlugin[]): PluginListBrowseRow[] {
  return plugins.map((catalogPlugin) => ({ section: "remote", catalogPlugin }));
}

export function filterLocalBrowseRows(
  plugins: Plugin[],
  search: string,
): PluginListBrowseRow[] {
  const parsed = parseListSearchQuery(search);
  if (parsed.raw.length === 0) {
    return toLocalBrowseRows(plugins);
  }

  const sectionIsLocal = parsed.section === "local";
  const textQuery = parsed.section !== undefined && parsed.section !== "local"
    ? { section: undefined, text: parsed.raw, raw: parsed.raw }
    : parsed;

  if (parsed.section !== undefined && parsed.section !== "local" && !sectionIsLocal) {
    return [];
  }

  const filtered = plugins.filter((plugin) => {
    const haystack = [plugin.name, plugin.description, ...plugin.tags].join(" ");
    return matchesListSearchQuery(haystack, textQuery);
  });
  return toLocalBrowseRows(filtered);
}

export function listNavigablePluginListBrowseRows(
  local: PluginListBrowseRow[],
  remote: PluginListBrowseRow[],
): PluginListBrowseRow[] {
  return [
    ...local.filter((row) => row.section === "local"),
    ...remote.filter((row) => row.section === "remote"),
  ];
}

export type PluginListBrowseActiveSectionContext = {
  section: PluginListSection;
  indexInSection: number;
  sectionRows: PluginListBrowseRow[];
  prevSection?: { section: PluginListSection; count: number };
  nextSection?: { section: PluginListSection; count: number };
};

function sectionCount(
  navigable: PluginListBrowseRow[],
  section: PluginListSection,
): number {
  return navigable.filter((row) => row.section === section).length;
}

function sectionLabel(section: PluginListSection, profileMode: boolean): string {
  if (section === "local") {
    return profileMode ? "Local profiles" : "Local plugins";
  }
  return "Remote catalog";
}

export function resolvePluginListActiveSectionContext(
  navigable: PluginListBrowseRow[],
  active: number,
): PluginListBrowseActiveSectionContext {
  const selected = navigable[active];
  if (!selected) {
    return { section: "local", indexInSection: 0, sectionRows: [] };
  }

  const section = selected.section;
  const sectionRows = navigable.filter((row) => row.section === section);
  const indexInSection = sectionRows.indexOf(selected);

  const sectionIndex = PLUGIN_LIST_SECTIONS.indexOf(section);
  const prevSection = PLUGIN_LIST_SECTIONS.slice(0, sectionIndex)
    .reverse()
    .map((prev) => ({
      section: prev,
      count: sectionCount(navigable, prev),
    }))
    .find((entry) => entry.count > 0);
  const nextSection = PLUGIN_LIST_SECTIONS.slice(sectionIndex + 1)
    .map((next) => ({
      section: next,
      count: sectionCount(navigable, next),
    }))
    .find((entry) => entry.count > 0);

  return { section, indexInSection, sectionRows, prevSection, nextSection };
}

function renderSectionSubheader(
  section: PluginListSection,
  count: number,
  profileMode: boolean,
  scopeLabel?: string,
): string {
  const label = sectionLabel(section, profileMode);
  const suffix = section === "remote" && scopeLabel
    ? theme.muted(` · ${scopeLabel} (${count})`)
    : theme.muted(` (${count})`);
  return `${theme.accent(label)}${suffix}`;
}

export function buildPluginViewportHintSegments(
  ctx: PluginListBrowseActiveSectionContext,
  viewport: SectionViewport,
  profileMode: boolean,
  scopeLabel?: string,
): string[] {
  const segments: string[] = [];
  const hiddenBelow = ctx.sectionRows.length - viewport.end;
  const hiddenAbove = viewport.start;
  if (hiddenAbove > 0) {
    segments.push(`↑ ${hiddenAbove} above`);
  }
  if (hiddenBelow > 0) {
    segments.push(
      `↓ ${hiddenBelow} more in ${sectionLabel(ctx.section, profileMode).toLowerCase()}`,
    );
  }
  if (ctx.nextSection) {
    segments.push(
      `${sectionLabel(ctx.nextSection.section, profileMode)} (${ctx.nextSection.count})`,
    );
    segments.push("↓ next section");
  }
  if (viewport.start === 0 && ctx.prevSection) {
    segments.push(
      `${sectionLabel(ctx.prevSection.section, profileMode)} (${ctx.prevSection.count})`,
    );
    segments.push("↑ prev section");
  }
  if (ctx.section === "remote" && scopeLabel && ctx.sectionRows.length === 0) {
    segments.push(`Catalog: ${scopeLabel}`);
  }
  return segments;
}

function renderViewportOverflowHints(
  ctx: PluginListBrowseActiveSectionContext,
  viewport: SectionViewport,
  profileMode: boolean,
  maxWidth: number,
  scopeLabel?: string,
): string {
  const folded = renderFoldedHintLine(
    buildPluginViewportHintSegments(ctx, viewport, profileMode, scopeLabel),
    maxWidth,
  );
  return folded.length > 0 ? theme.muted(folded) : "";
}

type LocalTableRow = {
  id?: string;
  name: string;
  origin: string;
  version: string;
  active?: string;
  description: string;
};

function formatOriginCell(origin: string): string {
  if (origin === "upstream" || origin === "catalog") {
    return theme.muted(origin);
  }
  return origin || "authored";
}

function makeLocalColumns(showId: boolean, profileMode: boolean): Column[] {
  const columns: Column[] = [];
  if (showId) {
    columns.push({
      key: "id",
      header: "ID",
      width: 12,
      transform: (value: string) => format.shortenId(String(value)),
    });
  }
  columns.push(
    {
      key: "name",
      header: "NAME",
      width: 26,
      style: (value) => (value.startsWith(">") ? theme.accent(value) : value),
    },
    {
      key: "origin",
      header: "ORIGIN",
      width: 12,
      style: (value) => formatOriginCell(String(value)),
    },
    { key: "version", header: "VERSION", width: 12 },
  );
  if (profileMode) {
    columns.push({ key: "active", header: "ACTIVE", width: 8 });
  }
  columns.push({
    key: "description",
    header: "DESCRIPTION",
    width: 44,
    transform: (value) => value || "—",
  });
  return columns;
}

function makeRemoteColumns(highlightSelection: boolean): Column[] {
  return [
    {
      key: "catalog",
      header: "CATALOG",
      width: 28,
    },
    {
      key: "slug",
      header: "PLUGIN",
      width: 26,
      style: highlightSelection
        ? (value) => (value.startsWith(">") ? theme.accent(value) : value)
        : undefined,
    },
    {
      key: "version",
      header: "VERSION",
      width: 12,
    },
    {
      key: "updatedAt",
      header: "UPDATED",
      width: 16,
      transform: (value) =>
        value ? format.formatRelativeTime(String(value)) : theme.muted("—"),
    },
  ];
}

function findInstalledLocalPlugin(
  catalogPlugin: CatalogPlugin,
  localPlugins: Plugin[],
): Plugin | undefined {
  const publishedMatches = localPlugins.filter(
    (plugin) =>
      plugin.org_slug === catalogPlugin.orgSlug
      && plugin.catalog_slug === catalogPlugin.catalogSlug
      && plugin.name === catalogPlugin.slug,
  );
  if (publishedMatches.length === 0) {
    return undefined;
  }
  return [...publishedMatches].sort((left, right) => semver.rcompare(left.version, right.version))[0];
}

function formatRemoteCatalogVersion(
  catalogPlugin: CatalogPlugin,
  localPlugins: Plugin[],
): string {
  const latestVersion = catalogPlugin.latestVersion;
  if (!latestVersion) {
    return theme.muted("—");
  }

  const installed = findInstalledLocalPlugin(catalogPlugin, localPlugins);
  const displayVersion = installed?.version ?? latestVersion;
  return formatVersionWithDrift(displayVersion, latestVersion);
}

function tableLayout(maxWidth?: number): { maxWidth: number; wordWrap: true } {
  return {
    maxWidth: maxWidth ?? terminalColumns(),
    wordWrap: true,
  };
}

function renderLocalSectionTable(
  rows: PluginListBrowseRow[],
  activeRow: PluginListBrowseRow | undefined,
  opts: {
    showId: boolean;
    profileMode: boolean;
    activeProfileName?: string | null;
    maxWidth?: number;
  },
): string {
  const localRows = rows.filter((row): row is Extract<PluginListBrowseRow, { section: "local" }> =>
    row.section === "local",
  );
  if (localRows.length === 0) {
    return theme.muted(opts.profileMode ? "No profile plugins found." : "No plugins found.");
  }

  const activePluginId = activeRow?.section === "local" ? activeRow.plugin.id : undefined;
  const tableRows: LocalTableRow[] = localRows.map((row) => ({
    ...(opts.showId ? { id: row.plugin.id } : {}),
    name: formatLocalPluginListName(row.plugin, {
      selected: row.plugin.id === activePluginId,
    }),
    origin: row.plugin.origin || "authored",
    version: formatPluginVersionLabel(row.plugin.version, row.plugin.dirty),
    ...(opts.profileMode
      ? {
          active: opts.activeProfileName === row.plugin.name ? "yes" : "",
        }
      : {}),
    description: row.plugin.description ?? "",
  }));

  return renderTable({
    columns: makeLocalColumns(opts.showId, opts.profileMode),
    rows: tableRows,
    ...tableLayout(opts.maxWidth),
  });
}

function renderRemoteSectionTable(
  rows: PluginListBrowseRow[],
  activeRow: PluginListBrowseRow | undefined,
  opts: { maxWidth?: number; localPlugins?: Plugin[] },
): string {
  const remoteRows = rows.filter((row): row is Extract<PluginListBrowseRow, { section: "remote" }> =>
    row.section === "remote",
  );
  if (remoteRows.length === 0) {
    return theme.muted("No matching plugins.");
  }

  const activeKey = activeRow?.section === "remote"
    ? catalogPluginKey(activeRow.catalogPlugin)
    : undefined;
  const localPlugins = opts.localPlugins ?? [];
  const tableRows = remoteRows.map((row) => {
    const isSelected = catalogPluginKey(row.catalogPlugin) === activeKey;
    return {
      catalog: formatCatalogScopePath(row.catalogPlugin),
      slug: formatCatalogPluginListSlug(row.catalogPlugin, { selected: isSelected }),
      version: formatRemoteCatalogVersion(row.catalogPlugin, localPlugins),
      updatedAt: row.catalogPlugin.updatedAt ?? "",
    };
  });

  return renderTable({
    columns: makeRemoteColumns(true),
    rows: tableRows,
    ...tableLayout(opts.maxWidth),
  });
}

export type PluginListBrowseViewportOptions = {
  activeIndex: number;
  navigable: PluginListBrowseRow[];
  terminalRows: number;
  maxWidth?: number;
  showId?: boolean;
  profileMode?: boolean;
  activeProfileName?: string | null;
  scopeLabel?: string;
  localPlugins?: Plugin[];
};

export function renderGroupedPluginListBrowseViewport(
  opts: PluginListBrowseViewportOptions,
): string {
  if (opts.navigable.length === 0) {
    return theme.muted("No matching plugins.");
  }

  const ctx = resolvePluginListActiveSectionContext(opts.navigable, opts.activeIndex);
  if (ctx.sectionRows.length === 0) {
    return theme.muted("No matching plugins.");
  }

  const profileMode = Boolean(opts.profileMode);
  const maxWidth = opts.maxWidth ?? terminalColumns();
  const maxVisibleRows = computeMaxVisibleTableRows(
    opts.terminalRows,
    VIEWPORT_CHROME_LINES.pluginListBrowse,
    { sectionOverhead: 6 },
  );
  const viewport = resolveSectionViewport(
    ctx.sectionRows.length,
    ctx.indexInSection,
    maxVisibleRows,
  );
  const visibleRows = ctx.sectionRows.slice(viewport.start, viewport.end);
  const activeRow = opts.navigable[opts.activeIndex];
  const table = ctx.section === "local"
    ? renderLocalSectionTable(visibleRows, activeRow, {
        showId: Boolean(opts.showId),
        profileMode,
        activeProfileName: opts.activeProfileName,
        maxWidth: opts.maxWidth,
      })
    : renderRemoteSectionTable(visibleRows, activeRow, {
        maxWidth: opts.maxWidth,
        localPlugins: opts.localPlugins,
      });

  return [
    renderSectionSubheader(
      ctx.section,
      ctx.sectionRows.length,
      profileMode,
      opts.scopeLabel,
    ),
    table,
    renderViewportOverflowHints(ctx, viewport, profileMode, maxWidth, opts.scopeLabel),
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function formatPluginListBrowseSelectionLabel(row: PluginListBrowseRow): string {
  if (row.section === "local") {
    return isProfilePlugin(row.plugin)
      ? `${icons.profile} ${row.plugin.name}`
      : row.plugin.name;
  }
  return isProfilePlugin(row.catalogPlugin)
    ? `${icons.profile} ${formatCatalogSelectionLabel(row.catalogPlugin)}`
    : formatCatalogSelectionLabel(row.catalogPlugin);
}
