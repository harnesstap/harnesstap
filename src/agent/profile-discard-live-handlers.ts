import {
  discardAllLiveResourcesFromHarness,
  discardLiveResourceFromHarness,
} from "../services/profile-untracked-resources.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";
import { parseAddResourceBody } from "./profile-add-resource-handlers.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDiscardResourceSelectors(
  body: unknown,
): Array<{ resourceType: string; resourceName: string }> | Response | undefined {
  if (!isRecord(body) || body.resources === undefined) {
    return undefined;
  }
  if (!Array.isArray(body.resources)) {
    return jsonResponse(
      { error: "invalid_resources", message: "resources must be an array" },
      { status: 400 },
    );
  }
  const selectors: Array<{ resourceType: string; resourceName: string }> = [];
  for (const entry of body.resources) {
    if (!isRecord(entry)) {
      return jsonResponse(
        { error: "invalid_resources", message: "resources entries must be objects" },
        { status: 400 },
      );
    }
    const resourceType =
      typeof entry.resourceType === "string" ? entry.resourceType.trim() : "";
    const resourceName =
      typeof entry.resourceName === "string" ? entry.resourceName.trim() : "";
    if (!resourceType || !resourceName) {
      return jsonResponse(
        {
          error: "invalid_resources",
          message: "each resource needs resourceType and resourceName",
        },
        { status: 400 },
      );
    }
    selectors.push({ resourceType, resourceName });
  }
  return selectors;
}

export async function handleProfileDiscardResource(
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

  const parsed = parseAddResourceBody(body);
  if (parsed instanceof Response) {
    return parsed;
  }

  const resourceType = isRecord(body) ? body.resourceType : undefined;
  if (typeof resourceType !== "string" || resourceType.trim().length === 0) {
    return jsonResponse(
      { error: "invalid_resource_type", message: "resourceType is required" },
      { status: 400 },
    );
  }

  const resourceName = isRecord(body) ? body.resourceName : undefined;
  if (typeof resourceName !== "string" || resourceName.trim().length === 0) {
    return jsonResponse(
      { error: "invalid_resource_name", message: "resourceName is required" },
      { status: 400 },
    );
  }

  try {
    const result = await discardLiveResourceFromHarness({
      profileSelector: profileName,
      resourceType: resourceType.trim(),
      resourceName: resourceName.trim(),
      ...parsed,
    });
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse(
      {
        error: "discard_resource_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}

export async function handleProfileDiscardAllResources(
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

  const parsed = parseAddResourceBody(body);
  if (parsed instanceof Response) {
    return parsed;
  }

  const resources = parseDiscardResourceSelectors(body);
  if (resources instanceof Response) {
    return resources;
  }

  try {
    const result = await discardAllLiveResourcesFromHarness({
      profileSelector: profileName,
      ...parsed,
      ...(resources ? { resources } : {}),
    });
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse(
      {
        error: "discard_all_resources_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
