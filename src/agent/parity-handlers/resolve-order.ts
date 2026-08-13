import { migrateOrderToOverrides } from "../../services/order-to-override-migration.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseJsonBody(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
}

function readJsonObject(body: unknown): Record<string, unknown> | Response {
  if (!isRecord(body)) {
    return jsonResponse({ error: "invalid_body" }, { status: 400 });
  }
  return body;
}

export async function tryHandle(
  request: Request,
  token: string,
  _deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/v1/migrate/resolve-order") {
    return null;
  }

  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  const bodyResult = await parseJsonBody(request);
  if (bodyResult instanceof Response) return bodyResult;

  const body = readJsonObject(bodyResult);
  if (body instanceof Response) return body;

  if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
    return jsonResponse(
      { error: "invalid_dry_run", message: "dryRun must be a boolean" },
      { status: 400 },
    );
  }

  const dryRun = body.dryRun === true;

  try {
    const report = migrateOrderToOverrides({ dryRun });
    return jsonResponse(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: "migrate_failed", message }, { status: 500 });
  }
}
