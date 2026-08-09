import { ProfileRenameError } from "../services/profile-commands.js";
import { getProfileDetail } from "../services/profile-edit.js";
import {
  cutLayerVersion,
  LayerVersionError,
} from "../services/layer-versioning.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";
import { profileEditErrorResponse } from "./profile-edit-handlers.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function dirtyLayersConflictResponse(
  layers: Array<{ name: string; version: string }>,
): Response {
  return jsonResponse(
    {
      error: "dirty_layers",
      message: `Cannot share layers with unpublished edits: ${layers
        .map((layer) => `${layer.name}@${layer.version}`)
        .join(", ")}`,
      dirty_layers: layers,
    },
    { status: 409 },
  );
}

export function layerVersionErrorResponse(error: LayerVersionError): Response {
  return jsonResponse(
    {
      error: error.code,
      message: error.message,
      ...(error.dirtyLayers ? { dirty_layers: error.dirtyLayers } : {}),
    },
    { status: 400 },
  );
}

export async function handleProfileCut(
  request: Request,
  token: string,
  name: string,
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

  const version = body.version;
  if (typeof version !== "string" || !version.trim()) {
    return jsonResponse(
      {
        error: "invalid_body",
        message: "version is required",
      },
      { status: 400 },
    );
  }

  try {
    const detail = getProfileDetail(name);
    const cut = cutLayerVersion({
      layerId: detail.profile.id,
      newVersion: version.trim(),
    });
    return jsonResponse({
      profile: {
        name: cut.name,
        version: cut.version,
        dirty: cut.dirty,
      },
    });
  } catch (error) {
    if (error instanceof LayerVersionError) {
      return layerVersionErrorResponse(error);
    }
    if (error instanceof ProfileRenameError) {
      return profileEditErrorResponse(error);
    }
    return profileEditErrorResponse(error);
  }
}
