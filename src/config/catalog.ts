import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnessdeckDir } from "../db/connection.js";
import { parseJsonc } from "./settings.js";

export const DEFAULT_CATALOG_ORG_SLUG = "harnessdeck-cloud";
export const DEFAULT_CLOUD_BASE_URL = "https://harnessdeck.kayrnt.fr";

export interface CatalogSettings {
  cloudBaseUrl: string;
  connectedOrgs: string[];
  connectedLibraries: string[];
}

export interface CatalogScope {
  defaultOrgSlug: string;
  orgs: string[];
  selectors: string[];
  cloudBaseUrl: string;
}

const DEFAULT_CATALOG_SETTINGS: CatalogSettings = {
  cloudBaseUrl: DEFAULT_CLOUD_BASE_URL,
  connectedOrgs: [],
  connectedLibraries: [],
};

function getConfigPath(harnessdeckDir = getHarnessdeckDir()): string {
  const jsoncPath = join(harnessdeckDir, "config.jsonc");
  if (existsSync(jsoncPath) || !existsSync(join(harnessdeckDir, "config.json"))) {
    return jsoncPath;
  }
  return join(harnessdeckDir, "config.json");
}

function normalizeOrgSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function normalizeSelector(selector: string): string {
  const trimmed = selector.trim();
  const match = trimmed.match(/^([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error(`Invalid library selector: ${selector}. Use org/library.`);
  }
  return `${match[1]}/${match[2]}`;
}

export function resolveCloudBaseUrl(override?: string): string {
  if (override?.trim()) {
    return override.replace(/\/+$/, "");
  }
  if (process.env.HARNESSDECK_CLOUD_URL?.trim()) {
    return process.env.HARNESSDECK_CLOUD_URL.replace(/\/+$/, "");
  }
  return loadCatalogSettings().cloudBaseUrl.replace(/\/+$/, "");
}

export function loadCatalogSettings(harnessdeckDir = getHarnessdeckDir()): CatalogSettings {
  const path = getConfigPath(harnessdeckDir);
  if (!existsSync(path)) {
    return { ...DEFAULT_CATALOG_SETTINGS };
  }

  try {
    const raw = parseJsonc(readFileSync(path, "utf-8")) as {
      catalog?: Partial<CatalogSettings>;
    };
    const catalog = raw.catalog ?? {};
    const connectedOrgs = Array.isArray(catalog.connectedOrgs)
      ? [...new Set(catalog.connectedOrgs.map((org) => normalizeOrgSlug(String(org))).filter(Boolean))]
      : [];
    const connectedLibraries = Array.isArray(catalog.connectedLibraries)
      ? [...new Set(catalog.connectedLibraries.map((selector) => normalizeSelector(String(selector))))]
      : [];

    return {
      cloudBaseUrl:
        typeof catalog.cloudBaseUrl === "string" && catalog.cloudBaseUrl.trim()
          ? catalog.cloudBaseUrl.replace(/\/+$/, "")
          : DEFAULT_CATALOG_SETTINGS.cloudBaseUrl,
      connectedOrgs: connectedOrgs.filter((org) => org !== DEFAULT_CATALOG_ORG_SLUG),
      connectedLibraries,
    };
  } catch {
    return { ...DEFAULT_CATALOG_SETTINGS };
  }
}

export function saveCatalogSettings(
  input: Partial<CatalogSettings>,
  harnessdeckDir = getHarnessdeckDir(),
): CatalogSettings {
  const path = getConfigPath(harnessdeckDir);
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = parseJsonc(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  const current = loadCatalogSettings(harnessdeckDir);
  const next: CatalogSettings = {
    cloudBaseUrl: input.cloudBaseUrl?.replace(/\/+$/, "") ?? current.cloudBaseUrl,
    connectedOrgs: input.connectedOrgs ?? current.connectedOrgs,
    connectedLibraries: input.connectedLibraries ?? current.connectedLibraries,
  };

  writeFileSync(
    path,
    `${JSON.stringify({ ...existing, catalog: next }, null, 2)}\n`,
    "utf-8",
  );

  return next;
}

export function resolveCatalogScope(input?: {
  baseUrl?: string;
  harnessdeckDir?: string;
}): CatalogScope {
  const settings = loadCatalogSettings(input?.harnessdeckDir);
  return {
    defaultOrgSlug: DEFAULT_CATALOG_ORG_SLUG,
    orgs: [
      DEFAULT_CATALOG_ORG_SLUG,
      ...settings.connectedOrgs,
    ],
    selectors: settings.connectedLibraries,
    cloudBaseUrl: resolveCloudBaseUrl(input?.baseUrl),
  };
}

export function formatCatalogScopeLabel(scope: CatalogScope): string {
  const extras = [
    ...scope.orgs.filter((org) => org !== scope.defaultOrgSlug),
    ...scope.selectors,
  ];
  if (extras.length === 0) {
    return scope.defaultOrgSlug;
  }
  return `${scope.defaultOrgSlug} + ${extras.join(", ")}`;
}

export function isSelectorInCatalogScope(
  selector: { orgSlug: string; librarySlug: string },
  scope: CatalogScope,
): boolean {
  const orgSlug = normalizeOrgSlug(selector.orgSlug);
  const librarySlug = selector.librarySlug.trim();
  const fullSelector = `${orgSlug}/${librarySlug}`;

  if (scope.orgs.map(normalizeOrgSlug).includes(orgSlug)) {
    return true;
  }

  return scope.selectors.map((entry) => normalizeSelector(entry)).includes(fullSelector);
}

export function formatOutOfScopeMessage(selector: string): string {
  return [
    `Library ${selector} is not in your catalog scope.`,
    `Connect the org:  hd layer catalog connect org <slug>`,
    `Connect one lib:  hd layer catalog connect library ${selector}`,
  ].join("\n");
}

export function connectCatalogOrg(orgSlug: string, harnessdeckDir = getHarnessdeckDir()): CatalogSettings {
  const normalized = normalizeOrgSlug(orgSlug);
  if (normalized === DEFAULT_CATALOG_ORG_SLUG) {
    throw new Error(`${DEFAULT_CATALOG_ORG_SLUG} is always included in the default catalog.`);
  }
  const current = loadCatalogSettings(harnessdeckDir);
  if (current.connectedOrgs.includes(normalized)) {
    return current;
  }
  return saveCatalogSettings({
    connectedOrgs: [...current.connectedOrgs, normalized],
  }, harnessdeckDir);
}

export function disconnectCatalogOrg(orgSlug: string, harnessdeckDir = getHarnessdeckDir()): CatalogSettings {
  const normalized = normalizeOrgSlug(orgSlug);
  if (normalized === DEFAULT_CATALOG_ORG_SLUG) {
    throw new Error(`Cannot disconnect the default catalog org (${DEFAULT_CATALOG_ORG_SLUG}).`);
  }
  const current = loadCatalogSettings(harnessdeckDir);
  return saveCatalogSettings({
    connectedOrgs: current.connectedOrgs.filter((org) => org !== normalized),
  }, harnessdeckDir);
}

export function connectCatalogLibrary(
  selector: string,
  harnessdeckDir = getHarnessdeckDir(),
): CatalogSettings {
  const normalized = normalizeSelector(selector);
  const current = loadCatalogSettings(harnessdeckDir);
  if (current.connectedLibraries.includes(normalized)) {
    return current;
  }
  return saveCatalogSettings({
    connectedLibraries: [...current.connectedLibraries, normalized],
  }, harnessdeckDir);
}

export function disconnectCatalogLibrary(
  selector: string,
  harnessdeckDir = getHarnessdeckDir(),
): CatalogSettings {
  const normalized = normalizeSelector(selector);
  const current = loadCatalogSettings(harnessdeckDir);
  return saveCatalogSettings({
    connectedLibraries: current.connectedLibraries.filter((entry) => entry !== normalized),
  }, harnessdeckDir);
}
