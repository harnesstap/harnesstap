import type { PluginMarketplacePlatform } from "../config/settings.js";
import { getHarnesstapDir } from "../db/connection.js";
import {
  listCatalogPlugins,
  refreshMarketplaceCatalog,
} from "../services/marketplace-catalog.js";
import { addMarketplace, listMarketplaces } from "../services/marketplace-registry.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

const VALID_PLATFORMS = new Set<PluginMarketplacePlatform>([
  "claude-code",
  "cursor",
  "goose",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePlatforms(value: unknown): PluginMarketplacePlatform[] | Response {
  const ids =
    Array.isArray(value) && value.length > 0 ? value : (["claude-code"] as const);

  const platforms: PluginMarketplacePlatform[] = [];
  for (const item of ids) {
    if (typeof item !== "string" || !VALID_PLATFORMS.has(item as PluginMarketplacePlatform)) {
      return jsonResponse(
        {
          error: "invalid_platform",
          message: "Each platform must be claude-code, cursor, or goose",
        },
        { status: 400 },
      );
    }
    platforms.push(item as PluginMarketplacePlatform);
  }
  return platforms;
}

export function handleMarketplacesList(request: Request, token: string): Response {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  const harnesstapDir = getHarnesstapDir();
  return jsonResponse({ marketplaces: listMarketplaces(harnesstapDir) });
}

export async function handleMarketplacesAdd(
  request: Request,
  token: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "invalid_json", message: "Request body must be JSON" },
      { status: 400 },
    );
  }

  if (!isRecord(body)) {
    return jsonResponse(
      { error: "invalid_body", message: "Request body must be an object" },
      { status: 400 },
    );
  }

  const url = body.url;
  if (typeof url !== "string" || !url.trim()) {
    return jsonResponse(
      { error: "invalid_url", message: "url is required" },
      { status: 400 },
    );
  }

  const name = body.name;
  if (typeof name !== "string" || !name.trim()) {
    return jsonResponse(
      { error: "invalid_name", message: "name is required" },
      { status: 400 },
    );
  }

  const platforms = parsePlatforms(body.platforms);
  if (platforms instanceof Response) {
    return platforms;
  }

  try {
    const harnesstapDir = getHarnesstapDir();
    const result = addMarketplace(harnesstapDir, {
      url: url.trim(),
      name: name.trim(),
      platforms,
    });
    const refresh = refreshMarketplaceCatalog(harnesstapDir, {
      name: result.entry.name,
      force: true,
    });
    return jsonResponse({ ...result, refresh });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: "marketplace_add_failed", message }, { status: 400 });
  }
}

export function handleMarketplacePluginsList(
  request: Request,
  token: string,
  name: string,
): Response {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  const harnesstapDir = getHarnesstapDir();
  const entry = listMarketplaces(harnesstapDir).find((marketplace) => marketplace.name === name);
  if (!entry) {
    return jsonResponse(
      { error: "not_found", message: `Marketplace not found: ${name}` },
      { status: 404 },
    );
  }

  const plugins = listCatalogPlugins(harnesstapDir, { name: entry.name });
  return jsonResponse({ marketplace: entry.name, plugins });
}
