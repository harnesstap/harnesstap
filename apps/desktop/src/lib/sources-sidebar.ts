import type { SourceKind } from "./sources-search";

export interface SourceRow {
  id: string;
  kind: SourceKind;
  label: string;
  removable: boolean;
  disconnectForbidden?: boolean;
}

export function buildSourceRows(input: {
  marketplaces: Array<{ name: string; managed?: boolean }>;
  defaultOrg: string;
  connectedOrgs: string[];
  registered: Array<{ org: string; catalog: string }>;
}): SourceRow[] {
  const rows: SourceRow[] = [
    { id: "local", kind: "local", label: "Local", removable: false },
  ];

  for (const marketplace of input.marketplaces) {
    rows.push({
      id: `mkt:${marketplace.name}`,
      kind: "marketplace",
      label: marketplace.name,
      removable: marketplace.managed !== false,
    });
  }

  rows.push({
    id: `org:${input.defaultOrg}`,
    kind: "cloud-org",
    label: input.defaultOrg,
    removable: false,
    disconnectForbidden: true,
  });

  for (const org of input.connectedOrgs) {
    if (org === input.defaultOrg) continue;
    rows.push({
      id: `org:${org}`,
      kind: "cloud-org",
      label: org,
      removable: true,
    });
  }

  for (const catalog of input.registered) {
    rows.push({
      id: `cat:${catalog.org}/${catalog.catalog}`,
      kind: "cloud-catalog",
      label: `${catalog.org}/${catalog.catalog}`,
      removable: true,
    });
  }

  return rows;
}

export function defaultCheckedSourceIds(rows: SourceRow[]): string[] {
  return rows.map((row) => row.id);
}

export function isSourcesFilterActive(
  query: string,
  checkedIds: string[],
  rows: SourceRow[],
): boolean {
  if (query.trim().length > 0) {
    return true;
  }
  const defaults = defaultCheckedSourceIds(rows);
  if (checkedIds.length !== defaults.length) {
    return true;
  }
  const checked = new Set(checkedIds);
  return defaults.some((id) => !checked.has(id));
}

export type SourceCheckState = "all" | "none" | "mixed";

export function sourceCheckState(
  checkedIds: string[],
  rows: SourceRow[],
): SourceCheckState {
  if (rows.length === 0) {
    return "none";
  }
  const checked = new Set(checkedIds);
  let selected = 0;
  for (const row of rows) {
    if (checked.has(row.id)) {
      selected += 1;
    }
  }
  if (selected === 0) {
    return "none";
  }
  if (selected === rows.length) {
    return "all";
  }
  return "mixed";
}

export function nextCheckedSourceIds(
  checkedIds: string[],
  rows: SourceRow[],
): string[] {
  const state = sourceCheckState(checkedIds, rows);
  switch (state) {
    case "all":
      return [];
    case "none":
    case "mixed":
      return defaultCheckedSourceIds(rows);
    default: {
      const neverState: never = state;
      return neverState;
    }
  }
}

export type SourceSectionId = "local" | "marketplaces" | "cloud";

export interface SourceSection {
  id: SourceSectionId;
  label: string;
  rows: SourceRow[];
}

export function groupSourceRows(rows: SourceRow[]): SourceSection[] {
  const local: SourceRow[] = [];
  const marketplaces: SourceRow[] = [];
  const cloud: SourceRow[] = [];

  for (const row of rows) {
    switch (row.kind) {
      case "local":
        local.push(row);
        break;
      case "marketplace":
        marketplaces.push(row);
        break;
      case "cloud-org":
      case "cloud-catalog":
        cloud.push(row);
        break;
      default: {
        const neverKind: never = row.kind;
        return neverKind;
      }
    }
  }

  const sections: SourceSection[] = [];
  if (local.length > 0) {
    sections.push({ id: "local", label: "Local", rows: local });
  }
  if (marketplaces.length > 0) {
    sections.push({ id: "marketplaces", label: "Marketplaces", rows: marketplaces });
  }
  if (cloud.length > 0) {
    sections.push({ id: "cloud", label: "Cloud", rows: cloud });
  }
  return sections;
}
