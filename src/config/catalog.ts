import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import { DEFAULT_CATALOG_SLUG } from "../services/layer-selector.js";
import { parseJsonc } from "./settings.js";

export const DEFAULT_CATALOG_ORG_SLUG = "harnesstap-cloud";
export const DEFAULT_CLOUD_BASE_URL = "https://cloud.harnesstap.com";

export interface RegisteredCatalog {
  org: string;
  catalog: string;
  account?: string;
}

export interface CatalogSettings {
  cloudBaseUrl: string;
  connectedOrgs: string[];
  connectedLayers: string[];
  publicCatalog: boolean;
  registered: RegisteredCatalog[];
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
  connectedLayers: [],
  publicCatalog: true,
  registered: [],
};

const INVALID_PUBLISH_CATALOG_SELECTOR =
  "Invalid catalog selector. Use org/catalog (e.g. acme/internal) or account@org/catalog.";

function normalizeCatalogSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

export function publishCatalogKey(catalog: Pick<RegisteredCatalog, "org" | "catalog">): string {
  return `${normalizeOrgSlug(catalog.org)}/${normalizeCatalogSlug(catalog.catalog)}`;
}

export function parsePublishCatalogSelector(selector: string): RegisteredCatalog {
  const trimmed = selector.trim();
  if (!trimmed) {
    throw new Error(INVALID_PUBLISH_CATALOG_SELECTOR);
  }

  let account: string | undefined;
  let path = trimmed;
  const atIndex = trimmed.indexOf("@");
  if (atIndex > 0) {
    const beforeAt = trimmed.slice(0, atIndex);
    const afterAt = trimmed.slice(atIndex + 1);
    if (!beforeAt.includes("/") && afterAt.includes("/")) {
      account = beforeAt.trim();
      path = afterAt;
    }
  }

  const parts = path.split("/").filter((part) => part.length > 0);
  if (parts.length !== 2) {
    throw new Error(INVALID_PUBLISH_CATALOG_SELECTOR);
  }

  const [org, catalog] = parts;
  if (!org || !catalog) {
    throw new Error(INVALID_PUBLISH_CATALOG_SELECTOR);
  }

  return {
    org: normalizeOrgSlug(org),
    catalog: normalizeCatalogSlug(catalog),
    ...(account ? { account } : {}),
  };
}

export function formatPublishCatalogSelector(catalog: RegisteredCatalog): string {
  const base = `${catalog.org}/${catalog.catalog}`;
  return catalog.account ? `${catalog.account}@${base}` : base;
}

function normalizeRegisteredCatalog(catalog: RegisteredCatalog): RegisteredCatalog {
  return {
    org: normalizeOrgSlug(catalog.org),
    catalog: normalizeCatalogSlug(catalog.catalog),
    ...(catalog.account?.trim() ? { account: catalog.account.trim() } : {}),
  };
}

function sortRegisteredCatalogs(catalogs: RegisteredCatalog[]): RegisteredCatalog[] {
  return [...catalogs].sort((left, right) => {
    const orgCompare = left.org.localeCompare(right.org);
    if (orgCompare !== 0) {
      return orgCompare;
    }
    return left.catalog.localeCompare(right.catalog);
  });
}

function getConfigPath(harnesstapDir = getHarnesstapDir()): string {
  const jsoncPath = join(harnesstapDir, "config.jsonc");
  if (existsSync(jsoncPath) || !existsSync(join(harnesstapDir, "config.json"))) {
    return jsoncPath;
  }
  return join(harnesstapDir, "config.json");
}

function normalizeOrgSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function normalizeSelector(selector: string): string {
  const trimmed = selector.trim();
  const parts = trimmed.split("/").filter((part) => part.length > 0);
  if (parts.length === 3) {
    return `${parts[0]}/${parts[1]}/${parts[2]}`;
  }
  throw new Error(
    `Invalid layer selector: ${selector}. Use org/catalog/layer.`,
  );
}

export function resolveCloudBaseUrl(override?: string): string {
  if (override?.trim()) {
    return override.replace(/\/+$/, "");
  }
  if (process.env.HARNESSTAP_CLOUD_URL?.trim()) {
    return process.env.HARNESSTAP_CLOUD_URL.replace(/\/+$/, "");
  }
  return loadCatalogSettings().cloudBaseUrl.replace(/\/+$/, "");
}

export function loadCatalogSettings(harnesstapDir = getHarnesstapDir()): CatalogSettings {
  const path = getConfigPath(harnesstapDir);
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
    const connectedLayers = Array.isArray(catalog.connectedLayers)
      ? [...new Set(catalog.connectedLayers.map((selector) => normalizeSelector(String(selector))))]
      : [];
    const registered = Array.isArray(catalog.registered)
      ? sortRegisteredCatalogs(
          catalog.registered
            .map((entry) => {
              if (!entry || typeof entry !== "object") {
                return undefined;
              }
              const record = entry as Partial<RegisteredCatalog>;
              if (typeof record.org !== "string" || typeof record.catalog !== "string") {
                return undefined;
              }
              return normalizeRegisteredCatalog({
                org: record.org,
                catalog: record.catalog,
                account: typeof record.account === "string" ? record.account : undefined,
              });
            })
            .filter((entry): entry is RegisteredCatalog => entry !== undefined),
        )
      : [];
    const registeredKeys = new Set<string>();
    const uniqueRegistered: RegisteredCatalog[] = [];
    for (const entry of registered) {
      const key = publishCatalogKey(entry);
      if (registeredKeys.has(key)) {
        continue;
      }
      registeredKeys.add(key);
      uniqueRegistered.push(entry);
    }

    return {
      cloudBaseUrl:
        typeof catalog.cloudBaseUrl === "string" && catalog.cloudBaseUrl.trim()
          ? catalog.cloudBaseUrl.replace(/\/+$/, "")
          : DEFAULT_CATALOG_SETTINGS.cloudBaseUrl,
      connectedOrgs: connectedOrgs.filter((org) => org !== DEFAULT_CATALOG_ORG_SLUG),
      connectedLayers,
      publicCatalog:
        typeof catalog.publicCatalog === "boolean"
          ? catalog.publicCatalog
          : DEFAULT_CATALOG_SETTINGS.publicCatalog,
      registered: uniqueRegistered,
    };
  } catch {
    return { ...DEFAULT_CATALOG_SETTINGS };
  }
}

export function saveCatalogSettings(
  input: Partial<CatalogSettings>,
  harnesstapDir = getHarnesstapDir(),
): CatalogSettings {
  const path = getConfigPath(harnesstapDir);
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = parseJsonc(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  const current = loadCatalogSettings(harnesstapDir);
  const next: CatalogSettings = {
    cloudBaseUrl: input.cloudBaseUrl?.replace(/\/+$/, "") ?? current.cloudBaseUrl,
    connectedOrgs: input.connectedOrgs ?? current.connectedOrgs,
    connectedLayers: input.connectedLayers ?? current.connectedLayers,
    publicCatalog: input.publicCatalog ?? current.publicCatalog,
    registered: input.registered ?? current.registered,
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
  harnesstapDir?: string;
}): CatalogScope {
  const settings = loadCatalogSettings(input?.harnesstapDir);
  return {
    defaultOrgSlug: DEFAULT_CATALOG_ORG_SLUG,
    orgs: [
      DEFAULT_CATALOG_ORG_SLUG,
      ...settings.connectedOrgs,
    ],
    selectors: settings.connectedLayers,
    cloudBaseUrl: resolveCloudBaseUrl(input?.baseUrl),
  };
}

export function isPublicCatalogEnabled(harnesstapDir = getHarnesstapDir()): boolean {
  const env = process.env.HARNESSTAP_PUBLIC_CATALOG?.trim().toLowerCase();
  if (env === "0" || env === "false" || env === "no") {
    return false;
  }
  if (env === "1" || env === "true" || env === "yes") {
    return true;
  }
  return loadCatalogSettings(harnesstapDir).publicCatalog;
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

function selectorVariants(selector: {
  orgSlug: string;
  catalogSlug: string;
  layerSlug: string;
}): string[] {
  const orgSlug = normalizeOrgSlug(selector.orgSlug);
  const catalogSlug = selector.catalogSlug.trim() || DEFAULT_CATALOG_SLUG;
  const layerSlug = selector.layerSlug.trim();
  const variants = [`${orgSlug}/${layerSlug}`];
  if (catalogSlug !== DEFAULT_CATALOG_SLUG) {
    variants.push(`${orgSlug}/${catalogSlug}/${layerSlug}`);
  }
  return variants;
}

export function isSelectorInCatalogScope(
  selector: { orgSlug: string; catalogSlug?: string; layerSlug: string },
  scope: CatalogScope,
): boolean {
  const orgSlug = normalizeOrgSlug(selector.orgSlug);
  const catalogSlug = selector.catalogSlug?.trim() || DEFAULT_CATALOG_SLUG;
  const layerSlug = selector.layerSlug.trim();

  if (scope.orgs.map(normalizeOrgSlug).includes(orgSlug)) {
    return true;
  }

  const normalizedScopeSelectors = scope.selectors.map((entry) => normalizeSelector(entry));
  return selectorVariants({ orgSlug, catalogSlug, layerSlug }).some((variant) =>
    normalizedScopeSelectors.includes(variant),
  );
}

export function formatOutOfScopeMessage(selector: string): string {
  return [
    `Layer ${selector} is not in your catalog scope.`,
    `Connect the org:  ht layer catalog connect org <slug>`,
    `Connect one lib:  ht layer catalog connect layer ${selector}`,
  ].join("\n");
}

export function connectCatalogOrg(orgSlug: string, harnesstapDir = getHarnesstapDir()): CatalogSettings {
  const normalized = normalizeOrgSlug(orgSlug);
  if (normalized === DEFAULT_CATALOG_ORG_SLUG) {
    throw new Error(`${DEFAULT_CATALOG_ORG_SLUG} is always included in the default catalog.`);
  }
  const current = loadCatalogSettings(harnesstapDir);
  if (current.connectedOrgs.includes(normalized)) {
    return current;
  }
  return saveCatalogSettings({
    connectedOrgs: [...current.connectedOrgs, normalized],
  }, harnesstapDir);
}

export function disconnectCatalogOrg(orgSlug: string, harnesstapDir = getHarnesstapDir()): CatalogSettings {
  const normalized = normalizeOrgSlug(orgSlug);
  if (normalized === DEFAULT_CATALOG_ORG_SLUG) {
    throw new Error(`Cannot disconnect the default catalog org (${DEFAULT_CATALOG_ORG_SLUG}).`);
  }
  const current = loadCatalogSettings(harnesstapDir);
  return saveCatalogSettings({
    connectedOrgs: current.connectedOrgs.filter((org) => org !== normalized),
  }, harnesstapDir);
}

export function connectCatalogLayer(
  selector: string,
  harnesstapDir = getHarnesstapDir(),
): CatalogSettings {
  const normalized = normalizeSelector(selector);
  const current = loadCatalogSettings(harnesstapDir);
  if (current.connectedLayers.includes(normalized)) {
    return current;
  }
  return saveCatalogSettings({
    connectedLayers: [...current.connectedLayers, normalized],
  }, harnesstapDir);
}

export function disconnectCatalogLayer(
  selector: string,
  harnesstapDir = getHarnesstapDir(),
): CatalogSettings {
  const normalized = normalizeSelector(selector);
  const current = loadCatalogSettings(harnesstapDir);
  return saveCatalogSettings({
    connectedLayers: current.connectedLayers.filter((entry) => entry !== normalized),
  }, harnesstapDir);
}

export function loadRegisteredCatalogs(harnesstapDir = getHarnesstapDir()): RegisteredCatalog[] {
  return loadCatalogSettings(harnesstapDir).registered;
}

export function registerPublishCatalog(
  selector: string,
  harnesstapDir = getHarnesstapDir(),
): { settings: CatalogSettings; catalog: RegisteredCatalog; created: boolean } {
  const parsed = parsePublishCatalogSelector(selector);
  const current = loadCatalogSettings(harnesstapDir);
  const key = publishCatalogKey(parsed);
  const existing = current.registered.find((entry) => publishCatalogKey(entry) === key);
  if (existing) {
    if (parsed.account && !existing.account) {
      const updated: RegisteredCatalog = { ...existing, account: parsed.account };
      const registered = current.registered.map((entry) =>
        publishCatalogKey(entry) === key ? updated : entry,
      );
      const settings = saveCatalogSettings({
        registered: sortRegisteredCatalogs(registered),
      }, harnesstapDir);
      return { settings, catalog: updated, created: false };
    }
    return { settings: current, catalog: existing, created: false };
  }
  const settings = saveCatalogSettings({
    registered: sortRegisteredCatalogs([...current.registered, parsed]),
  }, harnesstapDir);
  return { settings, catalog: parsed, created: true };
}

export function unregisterPublishCatalog(
  selector: string,
  harnesstapDir = getHarnesstapDir(),
): CatalogSettings {
  const parsed = parsePublishCatalogSelector(selector);
  const key = publishCatalogKey(parsed);
  const current = loadCatalogSettings(harnesstapDir);
  return saveCatalogSettings({
    registered: current.registered.filter((entry) => publishCatalogKey(entry) !== key),
  }, harnesstapDir);
}

export function ensureRegisteredPublishCatalog(
  selector: string,
  opts?: { account?: string },
  harnesstapDir = getHarnesstapDir(),
): { catalog: RegisteredCatalog; created: boolean } {
  const parsed = parsePublishCatalogSelector(selector);
  const withAccount = opts?.account?.trim()
    ? { ...parsed, account: opts.account.trim() }
    : parsed;
  const selectorLabel = formatPublishCatalogSelector(withAccount);
  const result = registerPublishCatalog(selectorLabel, harnesstapDir);
  return { catalog: result.catalog, created: result.created };
}
