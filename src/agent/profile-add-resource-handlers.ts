import type { ProfileApplyPreviewScope } from "../services/profile-apply-preview.js";
import { commitManagedResourceFromLive } from "../services/profile-commit-resource.js";
import {
  addAllUntrackedResourcesToProfile,
  addResourceToProfile,
} from "../services/profile-untracked-resources.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseScope(value: unknown): ProfileApplyPreviewScope | undefined {
  if (value === "home" || value === "project") {
    return value;
  }
  return undefined;
}

function parseAddResourceBody(body: unknown): Response | {
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
} {
  if (!isRecord(body)) {
    return jsonResponse({ error: "invalid_body" }, { status: 400 });
  }

  const scope = parseScope(body.scope);
  if (!scope) {
    return jsonResponse(
      { error: "invalid_scope", message: "scope must be home or project" },
      { status: 400 },
    );
  }

  const projectPath = body.projectPath;
  if (projectPath !== undefined && typeof projectPath !== "string") {
    return jsonResponse(
      { error: "invalid_project_path", message: "projectPath must be a string" },
      { status: 400 },
    );
  }

  const harness = body.harness;
  if (harness !== undefined && typeof harness !== "string") {
    return jsonResponse(
      { error: "invalid_harness", message: "harness must be a string" },
      { status: 400 },
    );
  }

  if (scope === "project" && (!projectPath || projectPath.trim().length === 0)) {
    return jsonResponse(
      {
        error: "project_path_required",
        message: "projectPath is required for project scope",
      },
      { status: 400 },
    );
  }

  return {
    scope,
    ...(projectPath && projectPath.trim()
      ? { projectPath: projectPath.trim() }
      : {}),
    ...(harness && harness.trim() ? { harness: harness.trim() } : {}),
  };
}

export async function handleProfileAddResource(
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
    const resource = await addResourceToProfile({
      profileSelector: profileName,
      resourceType: resourceType.trim(),
      resourceName: resourceName.trim(),
      ...parsed,
    });
    return jsonResponse({ resource });
  } catch (error) {
    return jsonResponse(
      {
        error: "add_resource_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}

export async function handleProfileAddAllResources(
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

  try {
    const result = await addAllUntrackedResourcesToProfile({
      profileSelector: profileName,
      ...parsed,
    });
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse(
      {
        error: "add_all_resources_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}

export async function handleProfileCommitResource(
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

  const path = isRecord(body) && typeof body.path === "string" ? body.path.trim() : "";
  const resourceType =
    isRecord(body) && typeof body.resourceType === "string"
      ? body.resourceType.trim()
      : "";
  const resourceName =
    isRecord(body) && typeof body.resourceName === "string"
      ? body.resourceName.trim()
      : "";

  if (!path && (!resourceType || !resourceName)) {
    return jsonResponse(
      {
        error: "invalid_commit_target",
        message: "path or resourceType+resourceName is required",
      },
      { status: 400 },
    );
  }

  try {
    const resource = await commitManagedResourceFromLive({
      profileSelector: profileName,
      resourceType,
      resourceName,
      ...(path ? { path } : {}),
      ...parsed,
    });
    return jsonResponse({ resource });
  } catch (error) {
    return jsonResponse(
      {
        error: "commit_resource_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
