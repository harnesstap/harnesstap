import { removeResourceFromProfile } from "../services/profile-remove-resource.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function handleProfileRemoveResource(
  request: Request,
  token: string,
  profileName: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return jsonResponse({ error: "invalid_body" }, { status: 400 });
  }

  const resourceType = body.resourceType;
  if (typeof resourceType !== "string" || resourceType.trim().length === 0) {
    return jsonResponse(
      { error: "invalid_resource_type", message: "resourceType is required" },
      { status: 400 },
    );
  }

  const resourceName = body.resourceName;
  if (typeof resourceName !== "string" || resourceName.trim().length === 0) {
    return jsonResponse(
      { error: "invalid_resource_name", message: "resourceName is required" },
      { status: 400 },
    );
  }

  const layerId = body.layerId;
  if (layerId !== undefined && typeof layerId !== "string") {
    return jsonResponse(
      { error: "invalid_layer_id", message: "layerId must be a string" },
      { status: 400 },
    );
  }

  try {
    const resource = removeResourceFromProfile({
      profileSelector: profileName,
      resourceType: resourceType.trim(),
      resourceName: resourceName.trim(),
      ...(typeof layerId === "string" && layerId.trim()
        ? { layerId: layerId.trim() }
        : {}),
    });
    return jsonResponse({ resource });
  } catch (error) {
    return jsonResponse(
      {
        error: "remove_resource_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
