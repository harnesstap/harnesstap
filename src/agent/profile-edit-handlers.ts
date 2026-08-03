import {
  ProfileRenameError,
  ProfileReservedNameError,
} from "../services/profile-commands.js";
import {
  attachProfileLayer,
  attachProfileResource,
  detachProfileAttachment,
  getProfileDetail,
  updateProfileMetadata,
} from "../services/profile-edit.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function profileEditErrorResponse(error: unknown): Response {
  if (error instanceof ProfileReservedNameError) {
    return jsonResponse(
      { error: "reserved_name", message: error.message },
      { status: 400 },
    );
  }
  if (error instanceof ProfileRenameError) {
    switch (error.code) {
      case "not_found":
        return jsonResponse(
          { error: "not_found", message: error.message },
          { status: 404 },
        );
      case "not_a_profile":
        return jsonResponse(
          { error: "not_a_profile", message: error.message },
          { status: 400 },
        );
      case "invalid_name":
      case "layer_exists":
      case "reserved_name":
        return jsonResponse(
          { error: error.code, message: error.message },
          { status: 400 },
        );
      default: {
        const _exhaustive: never = error.code;
        void _exhaustive;
        return jsonResponse(
          { error: "edit_failed", message: error.message },
          { status: 400 },
        );
      }
    }
  }
  return jsonResponse(
    { error: "edit_failed", message: errorMessage(error) },
    { status: 400 },
  );
}

export function handleProfileDetail(
  request: Request,
  token: string,
  name: string,
): Response {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }
  try {
    return jsonResponse(getProfileDetail(name));
  } catch (error) {
    return profileEditErrorResponse(error);
  }
}

export async function handleProfilePatch(
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

  const description = body.description;
  if (description !== undefined && typeof description !== "string") {
    return jsonResponse(
      { error: "invalid_description", message: "description must be a string" },
      { status: 400 },
    );
  }

  const tags = body.tags;
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
      return jsonResponse(
        { error: "invalid_tags", message: "tags must be an array of strings" },
        { status: 400 },
      );
    }
  }

  if (description === undefined && tags === undefined) {
    return jsonResponse(
      {
        error: "invalid_body",
        message: "Provide description and/or tags to update",
      },
      { status: 400 },
    );
  }

  try {
    return jsonResponse(
      updateProfileMetadata(name, {
        ...(description !== undefined ? { description } : {}),
        ...(tags !== undefined ? { tags: tags as string[] } : {}),
      }),
    );
  } catch (error) {
    return profileEditErrorResponse(error);
  }
}

export async function handleProfileAttach(
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

  const layerId = body.layerId;
  const resourceId = body.resourceId;
  if (typeof layerId === "string" && layerId.trim()) {
    if (resourceId !== undefined) {
      return jsonResponse(
        {
          error: "invalid_body",
          message: "Provide either layerId or resourceId, not both",
        },
        { status: 400 },
      );
    }
    try {
      return jsonResponse(await attachProfileLayer(name, layerId.trim()));
    } catch (error) {
      return profileEditErrorResponse(error);
    }
  }

  if (typeof resourceId === "string" && resourceId.trim()) {
    try {
      return jsonResponse(attachProfileResource(name, resourceId.trim()));
    } catch (error) {
      return profileEditErrorResponse(error);
    }
  }

  return jsonResponse(
    {
      error: "invalid_body",
      message: "layerId or resourceId is required",
    },
    { status: 400 },
  );
}

export async function handleProfileDetach(
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

  const resourceId = body.resourceId;
  const dependencyName = body.dependencyName;
  if (
    (resourceId === undefined || typeof resourceId !== "string")
    && (dependencyName === undefined || typeof dependencyName !== "string")
  ) {
    return jsonResponse(
      {
        error: "invalid_body",
        message: "resourceId or dependencyName is required",
      },
      { status: 400 },
    );
  }

  try {
    return jsonResponse(
      detachProfileAttachment(name, {
        ...(typeof resourceId === "string" ? { resourceId } : {}),
        ...(typeof dependencyName === "string" ? { dependencyName } : {}),
      }),
    );
  } catch (error) {
    return profileEditErrorResponse(error);
  }
}
