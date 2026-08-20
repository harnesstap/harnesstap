import {
  DEFAULT_CATALOG_ORG_SLUG,
  OPEN_CATALOG_ORG_ALIASES,
  connectCatalogOrg,
  disconnectCatalogOrg,
  loadCatalogSettings,
  loadRegisteredCatalogs,
} from "../../config/catalog.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

const SCOPE_PATH = "/v1/catalogs/scope";
const CONNECTED_ORG = /^\/v1\/catalogs\/connected-orgs\/([^/]+)$/;

type RouteDeps = { isAgentSwitchInProgress: () => boolean };
type ConnectedOrgMethod = "POST" | "DELETE";

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
