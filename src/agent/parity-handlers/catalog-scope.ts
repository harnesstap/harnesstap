import {
  DEFAULT_CATALOG_ORG_SLUG,
  OPEN_CATALOG_ORG_ALIASES,
  connectCatalogOrg,
  disconnectCatalogOrg,
  loadCatalogSettings,
  loadRegisteredCatalogs,
  parsePublishCatalogSelector,
} from "../../config/catalog.js";
import { getPluginByName } from "../../models/plugin-model.js";
import type { ApPackageFile } from "../../services/agent-plugins/files.js";
import { downloadCatalogPackage, resolveCatalogAccess } from "../../services/catalog-client.js";
import { isInvalidPreviewPath } from "../../utils/preview-path.js";
import {
  streamCatalogPlugins,
  type CatalogListSource,
} from "../../services/catalog-list-stream.js";
import type { CatalogPlugin } from "../../services/catalog-types.js";
import {
  formatCatalogSelector,
  resolveInstallSelector,
} from "../../services/plugin-bare-name-resolve.js";
import { installPluginFromCatalog } from "../../services/plugin-catalog-install.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

const SCOPE_PATH = "/v1/catalogs/scope";
const PLUGINS_PATH = "/v1/catalogs/plugins";
const PREVIEW_PATH = "/v1/catalogs/plugins/preview";
const PULL_PATH = "/v1/catalogs/plugins/pull";
const CONNECTED_ORG = /^\/v1\/catalogs\/connected-orgs\/([^/]+)$/;

type RouteDeps = { isAgentSwitchInProgress: () => boolean };
type ConnectedOrgMethod = "POST" | "DELETE";

interface CatalogPluginPullInput {
  selector: string;
  as?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDefaultOrgSlug(org: string): boolean {
  return (OPEN_CATALOG_ORG_ALIASES as readonly string[]).includes(org);
}

function decodeOrg(captured: string | undefined): string | Response {
  if (captured === undefined) {
    return jsonResponse(
      { error: "invalid_org", message: "org is required" },
      { status: 400 },
    );
  }

  let org: string;
  try {
    org = decodeURIComponent(captured).trim();
  } catch {
    return jsonResponse(
      { error: "invalid_org", message: "org is required" },
      { status: 400 },
    );
  }

  if (!org) {
    return jsonResponse(
      { error: "invalid_org", message: "org is required" },
      { status: 400 },
    );
  }

  return org;
}

function defaultOrgResponse(): Response {
  return jsonResponse({ error: "default_org" }, { status: 400 });
}

function handleScope(): Response {
  const settings = loadCatalogSettings();
  return jsonResponse({
    defaultOrg: DEFAULT_CATALOG_ORG_SLUG,
    publicCatalog: settings.publicCatalog,
    connectedOrgs: settings.connectedOrgs,
    registered: loadRegisteredCatalogs(),
  });
}

function handleConnectedOrg(method: ConnectedOrgMethod, org: string): Response {
  try {
    const settings = method === "POST"
      ? connectCatalogOrg(org)
      : disconnectCatalogOrg(org);
    return jsonResponse({ connectedOrgs: settings.connectedOrgs });
  } catch (error) {
    if (isDefaultOrgSlug(org.trim().toLowerCase())) {
      return defaultOrgResponse();
    }
    const message = errorMessage(error);
    return jsonResponse(
      { error: "catalog_org_failed", message },
      { status: 500 },
    );
  }
}

function pluginPayload(plugin: CatalogPlugin) {
  return {
    selector: formatCatalogSelector(plugin),
    name: plugin.name,
    orgSlug: plugin.orgSlug,
    catalogSlug: plugin.catalogSlug,
    version: plugin.latestVersion ?? "",
    tags: plugin.tags,
    description: plugin.summary,
  };
}

function queryValues(url: URL, key: string): string[] {
  return url.searchParams.getAll(key).map((value) => value.trim()).filter(Boolean);
}

function buildSearchSources(orgs: string[], registered: string[]): CatalogListSource[] | Response {
  const sources: CatalogListSource[] = orgs.map((org) => ({
    kind: "scope",
    label: org,
    orgs: [org],
    selectors: [],
  }));

  for (const selector of registered) {
    try {
      const parsed = parsePublishCatalogSelector(selector);
      sources.push({
        kind: "registered",
        label: `${parsed.org}/${parsed.catalog}`,
        orgs: [parsed.org],
        catalog: parsed.catalog,
        ...(parsed.account ? { account: parsed.account } : {}),
      });
    } catch (error) {
      return jsonResponse(
        { error: "invalid_registered", message: errorMessage(error) },
        { status: 400 },
      );
    }
  }

  return sources;
}

async function handlePluginSearch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const orgs = queryValues(url, "org");
  const registered = queryValues(url, "registered");
  if (orgs.length === 0 && registered.length === 0) {
    return jsonResponse({ plugins: [], errors: [] });
  }

  const sources = buildSearchSources(orgs, registered);
  if (sources instanceof Response) {
    return sources;
  }

  const q = url.searchParams.get("q")?.trim();
  const plugins: CatalogPlugin[] = [];
  const errors: Array<{ sourceLabel: string; message: string }> = [];

  for await (const event of streamCatalogPlugins(sources, {
    ...(q ? { q } : {}),
    sort: "name",
  })) {
    switch (event.type) {
      case "chunk":
        plugins.push(...event.chunk.plugins);
        break;
      case "error":
        errors.push({ sourceLabel: event.sourceLabel, message: event.message });
        break;
      case "done":
        break;
      default: {
        const _exhaustive: never = event;
        throw new Error(`Unhandled catalog stream event: ${String(_exhaustive)}`);
      }
    }
  }

  return jsonResponse({
    plugins: plugins.map(pluginPayload),
    errors,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parsePullInput(request: Request): Promise<CatalogPluginPullInput | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return jsonResponse({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof body.selector !== "string" || body.selector.trim().length === 0) {
    return jsonResponse(
      { error: "invalid_selector", message: "selector must be a non-empty string" },
      { status: 400 },
    );
  }
  if (
    body.as !== undefined
    && (typeof body.as !== "string" || body.as.trim().length === 0)
  ) {
    return jsonResponse(
      { error: "invalid_as", message: "as must be a non-empty string" },
      { status: 400 },
    );
  }
  return {
    selector: body.selector.trim(),
    ...(typeof body.as === "string" ? { as: body.as.trim() } : {}),
  };
}

function authRequiredResponse(): Response {
  return jsonResponse({ error: "auth_required" }, { status: 401 });
}

function utf8PackageContent(entry: ApPackageFile): string {
  switch (entry.encoding) {
    case "utf8":
      return entry.content;
    case "base64":
      return Buffer.from(entry.content, "base64").toString("utf8");
    default: {
      const _exhaustive: never = entry.encoding;
      return _exhaustive;
    }
  }
}

async function handlePluginPreview(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const selector = url.searchParams.get("selector")?.trim() ?? "";
  if (!selector) {
    return jsonResponse(
      { error: "invalid_selector", message: "selector must be a non-empty string" },
      { status: 400 },
    );
  }

  const path = url.searchParams.get("path")?.trim() || undefined;
  if (path && isInvalidPreviewPath(path)) {
    return jsonResponse({ error: "invalid_path" }, { status: 400 });
  }

  try {
    const access = await resolveCatalogAccess();
    if (!access.isAuthenticated) {
      return authRequiredResponse();
    }

    const parsed = await resolveInstallSelector(selector, {
      noInteractive: true,
      format: "json",
    });
    const downloaded = await downloadCatalogPackage({
      orgSlug: parsed.org_slug,
      catalogSlug: parsed.catalog_slug,
      pluginSlug: parsed.plugin_slug,
      version: parsed.version ?? "latest",
    });

    if (!path) {
      const files = Object.keys(downloaded.files)
        .sort()
        .map((filePath) => ({ path: filePath, kind: "file" as const }));
      return jsonResponse({ files });
    }

    const entry = downloaded.files[path];
    if (!entry) {
      return jsonResponse({ error: "not_found" }, { status: 404 });
    }
    return jsonResponse({ path, content: utf8PackageContent(entry) });
  } catch (error) {
    return jsonResponse(
      { error: "preview_failed", message: errorMessage(error) },
      { status: 400 },
    );
  }
}

async function handlePluginPull(request: Request): Promise<Response> {
  const input = await parsePullInput(request);
  if (input instanceof Response) {
    return input;
  }

  try {
    const access = await resolveCatalogAccess();
    if (!access.isAuthenticated) {
      return authRequiredResponse();
    }

    const parsed = await resolveInstallSelector(input.selector, {
      noInteractive: true,
      format: "json",
    });
    if (!input.as && getPluginByName(parsed.plugin_slug)) {
      return jsonResponse(
        {
          error: "name_collision",
          message: `A local plugin named "${parsed.plugin_slug}" already exists; provide as to pull under a different name`,
        },
        { status: 409 },
      );
    }

    const installed = await installPluginFromCatalog(parsed, {
      ...(input.as ? { as: input.as } : {}),
    });
    return jsonResponse({
      plugin: {
        name: installed.pluginName,
        id: installed.pluginId,
      },
      tagged: false,
    });
  } catch (error) {
    return jsonResponse(
      { error: "pull_failed", message: errorMessage(error) },
      { status: 400 },
    );
  }
}

export async function tryHandle(
  request: Request,
  token: string,
  _deps: RouteDeps,
): Promise<Response | null> {
  const url = new URL(request.url);
  const method = request.method;

  if (method === "GET" && url.pathname === SCOPE_PATH) {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    return handleScope();
  }

  if (method === "GET" && url.pathname === PLUGINS_PATH) {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    return handlePluginSearch(request);
  }

  if (method === "GET" && url.pathname === PREVIEW_PATH) {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    return handlePluginPreview(request);
  }

  if (method === "POST" && url.pathname === PULL_PATH) {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    return handlePluginPull(request);
  }

  const match = url.pathname.match(CONNECTED_ORG);
  if (!match) {
    return null;
  }

  if (method !== "POST" && method !== "DELETE") {
    return null;
  }

  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }

  const org = decodeOrg(match[1]);
  if (org instanceof Response) {
    return org;
  }

  switch (method) {
    case "POST":
      return handleConnectedOrg("POST", org);
    case "DELETE":
      return handleConnectedOrg("DELETE", org);
    default: {
      const _exhaustive: never = method;
      return jsonResponse(
        { error: "method_not_allowed", message: String(_exhaustive) },
        { status: 405 },
      );
    }
  }
}
