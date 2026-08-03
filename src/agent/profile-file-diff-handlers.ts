import type { ProfileApplyPreviewScope } from "../services/profile-apply-preview.js";
import { getManagedFileDiff } from "../services/profile-file-diff.js";
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

function parseFileDiffBody(body: unknown): Response | {
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
  path: string;
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

  const path = typeof body.path === "string" ? body.path.trim() : "";
  if (!path) {
    return jsonResponse(
      { error: "invalid_path", message: "path is required" },
      { status: 400 },
    );
  }

  return {
    scope,
    path,
    ...(projectPath && projectPath.trim()
      ? { projectPath: projectPath.trim() }
      : {}),
    ...(harness && harness.trim() ? { harness: harness.trim() } : {}),
  };
}

export async function handleProfileFileDiff(
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

  const parsed = parseFileDiffBody(body);
  if (parsed instanceof Response) {
    return parsed;
  }

  try {
    const result = await getManagedFileDiff({
      profileSelector: profileName,
      ...parsed,
    });
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse(
      {
        error: "file_diff_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
