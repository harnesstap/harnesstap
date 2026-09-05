import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";
import {
  getTelemetryConsentStatus,
  setTelemetryConsent,
  trackDesktopStartup,
} from "../telemetry/index.js";

export function handleTelemetryGet(request: Request, token: string): Response {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;
  return jsonResponse(getTelemetryConsentStatus());
}

export async function handleTelemetryPut(
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

  if (!body || typeof body !== "object") {
    return jsonResponse(
      { error: "invalid_body", message: "Request body must be an object" },
      { status: 400 },
    );
  }

  const enabled = (body as { enabled?: unknown }).enabled;
  if (typeof enabled !== "boolean") {
    return jsonResponse(
      { error: "invalid_enabled", message: "enabled must be a boolean" },
      { status: 400 },
    );
  }

  const status = setTelemetryConsent(enabled);
  if (status.enabled) {
    trackDesktopStartup();
  }
  return jsonResponse(status);
}
