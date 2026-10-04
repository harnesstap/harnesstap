import { queryLibraryInventory } from "../services/library-inventory.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

function parseOptionalNonNegativeInt(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

export function handleLibraryInventory(request: Request, token: string): Response {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const typeRaw = url.searchParams.get("type")?.trim() ?? "";
  const type = typeRaw.length > 0 ? typeRaw : null;
  const parsedLimit = parseOptionalNonNegativeInt(url.searchParams.get("limit"));
  const parsedOffset = parseOptionalNonNegativeInt(url.searchParams.get("offset")) ?? 0;

  const inventory = queryLibraryInventory({
    q,
    type,
    limit: parsedLimit,
    offset: parsedOffset,
  });

  return jsonResponse({
    ...inventory,
    ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
    offset: parsedOffset,
  });
}
