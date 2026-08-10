import {
  connectCatalogPlugin,
  connectCatalogOrg,
  DEFAULT_CATALOG_ORG_SLUG,
  disconnectCatalogPlugin,
  disconnectCatalogOrg,
  formatCatalogScopeLabel,
  loadCatalogSettings,
  loadRegisteredCatalogs,
  resolveCatalogScope,
} from "../config/catalog.js";
import {
  validatePublicPluginExists,
  validatePublicOrgHasPlugins,
} from "./catalog-client.js";
import { renderCatalogListTable } from "../ui/catalog-list-render.js";
import { ui } from "../ui/index.js";

export async function handlePluginCatalogListCommand(opts: {
  format?: string;
  baseUrl?: string;
}) {
  const scope = resolveCatalogScope({ baseUrl: opts.baseUrl });
  const settings = loadCatalogSettings();
  const registered = loadRegisteredCatalogs();
  const payload = {
    defaultOrg: DEFAULT_CATALOG_ORG_SLUG,
    cloudBaseUrl: scope.cloudBaseUrl,
    connectedOrgs: settings.connectedOrgs,
    connectedPlugins: settings.connectedPlugins,
    registered,
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
    `Connected plugins: ${payload.connectedPlugins.length > 0 ? payload.connectedPlugins.join(", ") : "—"}`,
  );
  console.log(
    `Registered publish catalogs: ${registered.length > 0 ? registered.map((entry) => `${entry.org}/${entry.catalog}`).join(", ") : "—"}`,
  );
}

export async function handlePluginCatalogConnectOrgCommand(
  orgSlug: string,
  opts: { baseUrl?: string },
) {
  const hasPlugins = await validatePublicOrgHasPlugins(orgSlug, opts.baseUrl);
  const settings = connectCatalogOrg(orgSlug);
  if (!hasPlugins) {
    ui.warn(`No public plugins found for org ${orgSlug} yet. Connection saved anyway.`);
  }
  ui.success(`Connected catalog org ${ui.theme.accent(orgSlug)}`);
  if (settings.connectedOrgs.length > 0) {
    ui.dim(`Connected orgs: ${settings.connectedOrgs.join(", ")}`);
  }
}

export async function handlePluginCatalogDisconnectOrgCommand(orgSlug: string) {
  const settings = disconnectCatalogOrg(orgSlug);
  ui.success(`Disconnected catalog org ${ui.theme.accent(orgSlug)}`);
  if (settings.connectedOrgs.length === 0) {
    ui.dim(`Only the default catalog (${DEFAULT_CATALOG_ORG_SLUG}) remains.`);
  }
}

export async function handlePluginCatalogConnectPluginCommand(
  selector: string,
  opts: { baseUrl?: string },
) {
  const exists = await validatePublicPluginExists(selector, opts.baseUrl);
  connectCatalogPlugin(selector);
  if (!exists) {
    ui.warn(`Public plugin ${selector} was not found. Connection saved anyway.`);
  } else {
    ui.success(`Connected catalog plugin ${ui.theme.accent(selector)}`);
  }
}

export async function handlePluginCatalogDisconnectPluginCommand(selector: string) {
  disconnectCatalogPlugin(selector);
  ui.success(`Disconnected catalog plugin ${ui.theme.accent(selector)}`);
}

export function renderPluginSearchResults(plugins: Parameters<typeof renderCatalogListTable>[0]) {
  if (plugins.length === 0) {
    ui.dim("No remote results.");
    return;
  }
  console.log(renderCatalogListTable(plugins));
}
