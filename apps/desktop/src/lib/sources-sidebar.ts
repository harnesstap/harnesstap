import type { SourceKind } from "./sources-search";

export interface SourceRow {
  id: string;
  kind: SourceKind;
  label: string;
  removable: boolean;
  disconnectForbidden?: boolean;
}

export function buildSourceRows(input: {
  marketplaces: Array<{ name: string }>;
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
      removable: true,
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
