import { getHarnesstapDir } from "../../db/connection.js";
import { removeMarketplace } from "../../services/marketplace-registry.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

const DELETE_MARKETPLACE =
  /^\/v1\/marketplaces\/([^/]+)$/;

export async function tryHandle(
  request: Request,
  token: string,
  _deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  if (request.method !== "DELETE") {
    return null;
  }

  const url = new URL(request.url);
  const match = url.pathname.match(DELETE_MARKETPLACE);
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

  let name: string;
  try {
    name = decodeURIComponent(captured).trim();
  } catch {
    return jsonResponse(
      { error: "invalid_name", message: "name is required" },
      { status: 400 },
    );
  }

  if (!name) {
    return jsonResponse(
      { error: "invalid_name", message: "name is required" },
      { status: 400 },
    );
  }

  try {
    const result = removeMarketplace(getHarnesstapDir(), name);
    switch (result.status) {
      case "not_found":
        return jsonResponse(
          { error: "not_found", message: `Marketplace not found: ${result.name}` },
          { status: 404 },
        );
      case "removed":
        return jsonResponse({ status: "removed", entry: result.entry });
      default: {
        const _exhaustive: never = result;
        return jsonResponse(
          { error: "marketplace_remove_failed", message: String(_exhaustive) },
          { status: 500 },
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      { error: "marketplace_remove_failed", message },
      { status: 500 },
    );
  }
}
