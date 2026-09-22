import { getHarnessInventory } from "../services/harness-inventory.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

export function handleHarnessInventoryGet(
  request: Request,
  token: string,
): Response {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  try {
    return jsonResponse(getHarnessInventory());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      { error: "harness_inventory_failed", message },
      { status: 500 },
    );
  }
}
