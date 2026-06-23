import type { CatalogLayer } from "../services/catalog-types.js";
import { isProfileLayer } from "../constants/profile.js";
import type { Layer } from "../types.js";
import * as format from "./format.js";
import {
  catalogLayerKey,
  formatCatalogSelectionLabel,
} from "./catalog-list-render.js";
import {
  computeMaxVisibleTableRows,
  resolveSectionViewport,
  VIEWPORT_CHROME_LINES,
  type SectionViewport,
} from "./list-viewport.js";
import { renderTable, type Column } from "./table.js";
import { icons, terminalColumns, theme } from "./theme.js";

export function formatLocalLayerListName(
  layer: Pick<Layer, "name" | "tags">,
  opts?: { selected?: boolean; static?: boolean },
): string {
  const kind = isProfileLayer(layer)
    ? `${theme.accent(icons.profile)} `
    : opts?.static
      ? ""
      : "  ";
  if (opts?.static) {
    return `${kind}${layer.name}`;
  }
  const cursor = opts?.selected ? ">" : " ";
  return `${cursor}${kind}${layer.name}`;
}

export function formatCatalogLayerListName(layer: Pick<CatalogLayer, "name" | "tags">): string {
  if (!isProfileLayer(layer)) {
    return layer.name;
  }
  return `${theme.accent(icons.profile)} ${layer.name}`;
}

export function formatCatalogLayerListSelector(
  layer: CatalogLayer,
  opts?: { selected?: boolean },
): string {
  const listDisplayName = formatCatalogSelectionLabel(layer);
  if (!isProfileLayer(layer)) {
    return opts?.selected ? `> ${listDisplayName}` : listDisplayName;
  }
  const marked = `${theme.accent(icons.profile)} ${listDisplayName}`;
  return opts?.selected ? `> ${marked}` : marked;
}

export const LAYER_LIST_SECTIONS = ["local", "remote"] as const;
export type LayerListSection = (typeof LAYER_LIST_SECTIONS)[number];

export type LayerListBrowseRow =
  | { section: "local"; layer: Layer }
  | { section: "remote"; catalogLayer: CatalogLayer };

export function layerListBrowseRowKey(row: LayerListBrowseRow): string {
  return row.section === "local"
    ? `local:${row.layer.id}`
    : `remote:${catalogLayerKey(row.catalogLayer)}`;
}

export function toLocalBrowseRows(layers: Layer[]): LayerListBrowseRow[] {
  return layers.map((layer) => ({ section: "local", layer }));
}

export function toRemoteBrowseRows(layers: CatalogLayer[]): LayerListBrowseRow[] {
  return layers.map((catalogLayer) => ({ section: "remote", catalogLayer }));
}

export function filterLocalBrowseRows(
  layers: Layer[],
  search: string,
): LayerListBrowseRow[] {
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = normalizedSearch.length === 0
    ? layers
    : layers.filter((layer) => {
        const haystack = [
          layer.name,
          layer.description,
          ...layer.tags,
        ].join(" ").toLowerCase();
        return haystack.includes(normalizedSearch);
      });
  return toLocalBrowseRows(filtered);
}

export function listNavigableLayerListBrowseRows(
  local: LayerListBrowseRow[],
  remote: LayerListBrowseRow[],
): LayerListBrowseRow[] {
  return [
    ...local.filter((row) => row.section === "local"),
    ...remote.filter((row) => row.section === "remote"),
  ];
}

export type LayerListBrowseActiveSectionContext = {
  section: LayerListSection;
  indexInSection: number;
  sectionRows: LayerListBrowseRow[];
  prevSection?: { section: LayerListSection; count: number };
  nextSection?: { section: LayerListSection; count: number };
};

function sectionCount(
  navigable: LayerListBrowseRow[],
  section: LayerListSection,
): number {
  return navigable.filter((row) => row.section === section).length;
}

function sectionLabel(section: LayerListSection, profileMode: boolean): string {
  if (section === "local") {
    return profileMode ? "Local profiles" : "Local layers";
  }
  return "Remote catalog";
}

export function resolveLayerListActiveSectionContext(
  navigable: LayerListBrowseRow[],
  active: number,
): LayerListBrowseActiveSectionContext {
  const selected = navigable[active];
  if (!selected) {
    return { section: "local", indexInSection: 0, sectionRows: [] };
  }

  const section = selected.section;
  const sectionRows = navigable.filter((row) => row.section === section);
  const indexInSection = sectionRows.indexOf(selected);

  const sectionIndex = LAYER_LIST_SECTIONS.indexOf(section);
  const prevSection = LAYER_LIST_SECTIONS.slice(0, sectionIndex)
    .reverse()
    .map((prev) => ({
      section: prev,
      count: sectionCount(navigable, prev),
    }))
    .find((entry) => entry.count > 0);
  const nextSection = LAYER_LIST_SECTIONS.slice(sectionIndex + 1)
    .map((next) => ({
      section: next,
      count: sectionCount(navigable, next),
    }))
    .find((entry) => entry.count > 0);

  return { section, indexInSection, sectionRows, prevSection, nextSection };
}

function renderSectionSubheader(
  section: LayerListSection,
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

function renderViewportOverflowHints(
  ctx: LayerListBrowseActiveSectionContext,
  viewport: SectionViewport,
  profileMode: boolean,
  scopeLabel?: string,
): string[] {
  const hints: string[] = [];
  const hiddenBelow = ctx.sectionRows.length - viewport.end;
  const hiddenAbove = viewport.start;
  if (hiddenAbove > 0) {
    hints.push(theme.muted(`  ↑ ${hiddenAbove} above`));
  }
  if (hiddenBelow > 0) {
    hints.push(
      theme.muted(
        `  ↓ ${hiddenBelow} more in ${sectionLabel(ctx.section, profileMode).toLowerCase()}`,
      ),
    );
  }
  if (ctx.nextSection) {
    hints.push(
      theme.muted(
        `  ${sectionLabel(ctx.nextSection.section, profileMode)} (${ctx.nextSection.count}) · ↓ next section`,
      ),
    );
  }
  if (viewport.start === 0 && ctx.prevSection) {
    hints.push(
      theme.muted(
        `  ${sectionLabel(ctx.prevSection.section, profileMode)} (${ctx.prevSection.count}) · ↑ prev section`,
      ),
    );
  }
  if (ctx.section === "remote" && scopeLabel && ctx.sectionRows.length === 0) {
    hints.push(theme.muted(`  Catalog: ${scopeLabel}`));
  }
  return hints;
}

type LocalTableRow = {
  id?: string;
  name: string;
  version: string;
  active?: string;
  description: string;
};

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
      key: "list_display_name",
      header: "ORG/CATALOG/LAYER",
      width: 40,
      style: highlightSelection
        ? (value) => (value.startsWith(">") ? theme.accent(value) : value)
        : undefined,
    },
    {
      key: "name",
      header: "NAME",
      width: 22,
    },
    {
      key: "visibility",
      header: "VIS",
      width: 8,
      transform: (value) => String(value).slice(0, 4),
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

function tableLayout(maxWidth?: number): { maxWidth: number; wordWrap: true } {
  return {
    maxWidth: maxWidth ?? terminalColumns(),
    wordWrap: true,
  };
}

function renderLocalSectionTable(
  rows: LayerListBrowseRow[],
  activeRow: LayerListBrowseRow | undefined,
  opts: {
    showId: boolean;
    profileMode: boolean;
    activeProfileName?: string | null;
    maxWidth?: number;
  },
): string {
  const localRows = rows.filter((row): row is Extract<LayerListBrowseRow, { section: "local" }> =>
    row.section === "local",
  );
  if (localRows.length === 0) {
    return theme.muted(opts.profileMode ? "No profile layers found." : "No layers found.");
  }

  const activeLayerId = activeRow?.section === "local" ? activeRow.layer.id : undefined;
  const tableRows: LocalTableRow[] = localRows.map((row) => ({
    ...(opts.showId ? { id: row.layer.id } : {}),
    name: formatLocalLayerListName(row.layer, {
      selected: row.layer.id === activeLayerId,
    }),
    version: row.layer.version,
    ...(opts.profileMode
      ? {
          active: opts.activeProfileName === row.layer.name ? "yes" : "",
        }
      : {}),
    description: row.layer.description ?? "",
  }));

  return renderTable({
    columns: makeLocalColumns(opts.showId, opts.profileMode),
    rows: tableRows,
    ...tableLayout(opts.maxWidth),
  });
}

function renderRemoteSectionTable(
  rows: LayerListBrowseRow[],
  activeRow: LayerListBrowseRow | undefined,
  opts: { maxWidth?: number },
): string {
  const remoteRows = rows.filter((row): row is Extract<LayerListBrowseRow, { section: "remote" }> =>
    row.section === "remote",
  );
  if (remoteRows.length === 0) {
    return theme.muted("No matching layers.");
  }

  const activeKey = activeRow?.section === "remote"
    ? catalogLayerKey(activeRow.catalogLayer)
    : undefined;
  const tableRows = remoteRows.map((row) => {
    const listDisplayName = formatCatalogLayerListSelector(row.catalogLayer, {
      selected: catalogLayerKey(row.catalogLayer) === activeKey,
    });
    return {
      ...row.catalogLayer,
      list_display_name: listDisplayName,
      name: formatCatalogLayerListName(row.catalogLayer),
    };
  });

  return renderTable({
    columns: makeRemoteColumns(true),
    rows: tableRows,
    ...tableLayout(opts.maxWidth),
  });
}

export type LayerListBrowseViewportOptions = {
  activeIndex: number;
  navigable: LayerListBrowseRow[];
  terminalRows: number;
  maxWidth?: number;
  showId?: boolean;
  profileMode?: boolean;
  activeProfileName?: string | null;
  scopeLabel?: string;
};

export function renderGroupedLayerListBrowseViewport(
  opts: LayerListBrowseViewportOptions,
): string {
  if (opts.navigable.length === 0) {
    return theme.muted("No matching layers.");
  }

  const ctx = resolveLayerListActiveSectionContext(opts.navigable, opts.activeIndex);
  if (ctx.sectionRows.length === 0) {
    return theme.muted("No matching layers.");
  }

  const profileMode = Boolean(opts.profileMode);
  const maxVisibleRows = computeMaxVisibleTableRows(
    opts.terminalRows,
    VIEWPORT_CHROME_LINES.layerListBrowse,
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
      });

  return [
    renderSectionSubheader(
      ctx.section,
      ctx.sectionRows.length,
      profileMode,
      opts.scopeLabel,
    ),
    table,
    ...renderViewportOverflowHints(ctx, viewport, profileMode, opts.scopeLabel),
  ].join("\n");
}

export function formatLayerListBrowseSelectionLabel(row: LayerListBrowseRow): string {
  if (row.section === "local") {
    return isProfileLayer(row.layer)
      ? `${icons.profile} ${row.layer.name}`
      : row.layer.name;
  }
  return isProfileLayer(row.catalogLayer)
    ? `${icons.profile} ${formatCatalogSelectionLabel(row.catalogLayer)}`
    : formatCatalogSelectionLabel(row.catalogLayer);
}

export function renderLocalLayerBrowseShow(
  layer: Layer,
  opts?: { activeProfileName?: string | null },
): string {
  const lines = [
    `${theme.accent(layer.name)}`,
    ...(isProfileLayer(layer) ? [`Type: ${theme.accent(`${icons.profile} profile`)}`] : []),
    `Version: ${layer.version}`,
  ];
  if (opts?.activeProfileName === layer.name) {
    lines.push(theme.info("Active profile"));
  }
  lines.push(`Description: ${layer.description || theme.muted("—")}`);
  if (layer.tags.length > 0) {
    lines.push(`Tags: ${layer.tags.join(", ")}`);
  }
  return lines.join("\n");
}
