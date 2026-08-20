import { getHarnesstapDir } from "../../db/connection.js";
import { previewMarketplacePlugin } from "../../services/marketplace-plugin-tree.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

const TREE_PATH =
  /^\/v1\/marketplaces\/([^/]+)\/plugins\/([^/]+)\/tree$/;

function decodeSegment(
  captured: string | undefined,
  error: string,
  message: string,
): string | Response {
  if (captured === undefined) {
    return jsonResponse({ error, message }, { status: 400 });
  }
  try {
    const value = decodeURIComponent(captured).trim();
    if (!value) {
      return jsonResponse({ error, message }, { status: 400 });
    }
    return value;
  } catch {
    return jsonResponse({ error, message }, { status: 400 });
  }
}

export async function tryHandle(
  request: Request,
  token: string,
  _deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  if (request.method !== "GET") {
    return null;
  }

  const url = new URL(request.url);
  const match = url.pathname.match(TREE_PATH);
  if (!match) {
    return null;
  }

  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  const marketplace = decodeSegment(match[1], "invalid_name", "name is required");
  if (marketplace instanceof Response) return marketplace;

  const plugin = decodeSegment(match[2], "invalid_plugin", "plugin is required");
  if (plugin instanceof Response) return plugin;

  const path = url.searchParams.get("path")?.trim() || undefined;
  const result = previewMarketplacePlugin(getHarnesstapDir(), {
    marketplace,
    plugin,
    ...(path ? { path } : {}),
  });

  switch (result.status) {
    case "invalid_path":
      return jsonResponse({ error: "invalid_path" }, { status: 400 });
    case "not_found":
      return jsonResponse({ error: "not_found" }, { status: 404 });
    case "ok":
      if ("files" in result) {
        return jsonResponse({ files: result.files });
      }
      return jsonResponse({ path: result.path, content: result.content });
    default: {
      const _exhaustive: never = result;
      return jsonResponse(
        { error: "marketplace_tree_failed", message: String(_exhaustive) },
        { status: 500 },
      );
    }
  }
}
