import { searchDiscover } from "../services/discover-search.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

export function handleDiscoverSearch(request: Request, token: string): Response {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const sourcesRaw = url.searchParams.get("sources") ?? "";
  const sourceIds = sourcesRaw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return jsonResponse(searchDiscover({ q, sourceIds }));
}
