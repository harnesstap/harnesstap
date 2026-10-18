import {
  isUpdateFrequency,
  isUpdateMode,
  loadUpdateSettings,
  saveUpdateSettings,
  type UpdateSettings,
} from "../../config/settings.js";
import { getHarnesstapDir } from "../../db/connection.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

const PATH = "/v1/settings/updates";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates a partial `updates` body. Returns the patch or an error message. */
export function parseUpdateSettingsPatch(body: unknown): Partial<UpdateSettings> | string {
  if (!isRecord(body)) return "body must be an object";
  const patch: Partial<UpdateSettings> = {};
  for (const key of Object.keys(body)) {
    if (key !== "mode" && key !== "frequency" && key !== "prompted") return `unknown key: ${key}`;
  }
  if (body.mode !== undefined) {
    if (!isUpdateMode(body.mode)) return "mode must be off, notify or install";
    patch.mode = body.mode;
  }
  if (body.frequency !== undefined) {
    if (!isUpdateFrequency(body.frequency)) return "frequency must be hourly, daily or weekly";
    patch.frequency = body.frequency;
  }
  if (body.prompted !== undefined) {
    if (typeof body.prompted !== "boolean") return "prompted must be true or false";
    patch.prompted = body.prompted;
  }
  return patch;
}

/**
 * GET /v1/settings/updates  {mode, frequency, prompted}
 * PUT /v1/settings/updates  partial body; answers the saved settings
 */
export async function tryHandle(
  request: Request,
  token: string,
  _deps: unknown,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname !== PATH) return null;
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  if (request.method === "GET") {
    return jsonResponse(loadUpdateSettings(getHarnesstapDir()));
  }
  if (request.method === "PUT") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, { status: 400 });
    }
    const patch = parseUpdateSettingsPatch(body);
    if (typeof patch === "string") {
      return jsonResponse({ error: "invalid_body", message: patch }, { status: 400 });
    }
    return jsonResponse(saveUpdateSettings(getHarnesstapDir(), patch));
  }
  return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
}
