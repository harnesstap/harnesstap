import {
  connectCatalogLibrary,
  connectCatalogOrg,
  DEFAULT_CATALOG_ORG_SLUG,
  disconnectCatalogLibrary,
  disconnectCatalogOrg,
  formatCatalogScopeLabel,
  loadCatalogSettings,
  resolveCatalogScope,
} from "../config/catalog.js";
import {
  validatePublicLibraryExists,
  validatePublicOrgHasLibraries,
} from "./catalog-client.js";
import { renderCatalogListTable } from "../ui/catalog-list-render.js";
import { ui } from "../ui/index.js";

export async function handleLayerCatalogListCommand(opts: {
  format?: string;
  baseUrl?: string;
}) {
  const scope = resolveCatalogScope({ baseUrl: opts.baseUrl });
  const settings = loadCatalogSettings();
  const payload = {
    defaultOrg: DEFAULT_CATALOG_ORG_SLUG,
    cloudBaseUrl: scope.cloudBaseUrl,
    connectedOrgs: settings.connectedOrgs,
    connectedLibraries: settings.connectedLibraries,
    scopeLabel: formatCatalogScopeLabel(scope),
  };

  if (opts.format === "json") {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`Default catalog: ${payload.defaultOrg}`);
  console.log(`Cloud base URL: ${payload.cloudBaseUrl}`);
  console.log(`Connected orgs: ${payload.connectedOrgs.length > 0 ? payload.connectedOrgs.join(", ") : "—"}`);
  console.log(
    `Connected libraries: ${payload.connectedLibraries.length > 0 ? payload.connectedLibraries.join(", ") : "—"}`,
  );
}

export async function handleLayerCatalogConnectOrgCommand(
  orgSlug: string,
  opts: { baseUrl?: string },
) {
  const hasLibraries = await validatePublicOrgHasLibraries(orgSlug, opts.baseUrl);
  const settings = connectCatalogOrg(orgSlug);
  if (!hasLibraries) {
    ui.warn(`No public libraries found for org ${orgSlug} yet. Connection saved anyway.`);
  }
  ui.success(`Connected catalog org ${ui.theme.accent(orgSlug)}`);
  if (settings.connectedOrgs.length > 0) {
    ui.dim(`Connected orgs: ${settings.connectedOrgs.join(", ")}`);
  }
}

export async function handleLayerCatalogDisconnectOrgCommand(orgSlug: string) {
  const settings = disconnectCatalogOrg(orgSlug);
  ui.success(`Disconnected catalog org ${ui.theme.accent(orgSlug)}`);
  if (settings.connectedOrgs.length === 0) {
    ui.dim(`Only the default catalog (${DEFAULT_CATALOG_ORG_SLUG}) remains.`);
  }
}

export async function handleLayerCatalogConnectLibraryCommand(
  selector: string,
  opts: { baseUrl?: string },
) {
  const exists = await validatePublicLibraryExists(selector, opts.baseUrl);
  connectCatalogLibrary(selector);
  if (!exists) {
    ui.warn(`Public library ${selector} was not found. Connection saved anyway.`);
  } else {
    ui.success(`Connected catalog library ${ui.theme.accent(selector)}`);
  }
}

export async function handleLayerCatalogDisconnectLibraryCommand(selector: string) {
  disconnectCatalogLibrary(selector);
  ui.success(`Disconnected catalog library ${ui.theme.accent(selector)}`);
}

export function renderLayerSearchResults(libraries: Parameters<typeof renderCatalogListTable>[0]) {
  if (libraries.length === 0) {
    ui.dim("No remote results.");
    return;
  }
  console.log(renderCatalogListTable(libraries));
}
