import type { PluginMarketplacePlatform } from "../../config/settings.js";
import { getHarnesstapDir } from "../../db/connection.js";
import { refreshMarketplaceCatalog } from "../../services/marketplace-catalog.js";
import { updateMarketplace } from "../../services/marketplace-registry.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

const PATCH_MARKETPLACE = /^\/v1\/marketplaces\/([^/]+)$/;

const VALID_PLATFORMS = new Set<PluginMarketplacePlatform>([
  "claude-code",
  "cursor",
  "goose",
  "copilot-cli",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOptionalPlatforms(
  value: unknown,
): PluginMarketplacePlatform[] | Response | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    return jsonResponse(
      {
        error: "invalid_platform",
        message: "At least one platform is required",
      },
      { status: 400 },
    );
  }

  const platforms: PluginMarketplacePlatform[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !VALID_PLATFORMS.has(item as PluginMarketplacePlatform)) {
      return jsonResponse(
        {
          error: "invalid_platform",
          message: "Each platform must be claude-code, cursor, goose, or copilot-cli",
        },
        { status: 400 },
      );
    }
    platforms.push(item as PluginMarketplacePlatform);
  }
  return platforms;
}

export async function tryHandle(
  request: Request,
  token: string,
  _deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  if (request.method !== "PATCH") {
    return null;
  }

  const url = new URL(request.url);
  const match = url.pathname.match(PATCH_MARKETPLACE);
  if (!match) {
    return null;
  }

  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  const captured = match[1];
  if (captured === undefined) {
    return jsonResponse(
      { error: "invalid_name", message: "name is required" },
      { status: 400 },
    );
  }

  let currentName: string;
  try {
    currentName = decodeURIComponent(captured).trim();
  } catch {
    return jsonResponse(
      { error: "invalid_name", message: "name is required" },
      { status: 400 },
    );
  }

  if (!currentName) {
    return jsonResponse(
      { error: "invalid_name", message: "name is required" },
      { status: 400 },
    );
  }

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

  if (body.name !== undefined && typeof body.name !== "string") {
    return jsonResponse(
      { error: "invalid_name", message: "name must be a string" },
      { status: 400 },
    );
  }

  if (body.url !== undefined && typeof body.url !== "string") {
    return jsonResponse(
      { error: "invalid_url", message: "url must be a string" },
      { status: 400 },
    );
  }

  const platforms = parseOptionalPlatforms(body.platforms);
  if (platforms instanceof Response) {
    return platforms;
  }

  try {
    const harnesstapDir = getHarnesstapDir();
    const result = updateMarketplace(harnesstapDir, currentName, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(platforms !== undefined ? { platforms } : {}),
    });
    switch (result.status) {
      case "not_found":
        return jsonResponse(
          { error: "not_found", message: `Marketplace not found: ${result.name}` },
          { status: 404 },
        );
      case "updated": {
        if (result.urlChanged) {
          const refresh = refreshMarketplaceCatalog(harnesstapDir, {
            name: result.entry.name,
            force: true,
          });
          return jsonResponse({ ...result, refresh });
        }
        return jsonResponse(result);
      }
      default: {
        const _exhaustive: never = result;
        return jsonResponse(
          { error: "marketplace_update_failed", message: String(_exhaustive) },
          { status: 500 },
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/name conflict/i.test(message)) {
      return jsonResponse({ error: "name_conflict", message }, { status: 409 });
    }
    return jsonResponse({ error: "marketplace_update_failed", message }, { status: 400 });
  }
}
