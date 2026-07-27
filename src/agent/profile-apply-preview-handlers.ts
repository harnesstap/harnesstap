import {
  previewProfileApply,
  type ProfileApplyPreviewScope,
} from "../services/profile-apply-preview.js";
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

export async function handleProfileApplyPreview(
  request: Request,
  token: string,
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

  const profile = body.profile;
  if (typeof profile !== "string" || profile.trim().length === 0) {
    return jsonResponse(
      { error: "invalid_profile", message: "profile is required" },
      { status: 400 },
    );
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

  try {
    const preview = await previewProfileApply({
      profile: profile.trim(),
      scope,
      ...(projectPath && projectPath.trim()
        ? { projectPath: projectPath.trim() }
        : {}),
      ...(harness && harness.trim() ? { harness: harness.trim() } : {}),
    });
    return jsonResponse(preview);
  } catch (error) {
    return jsonResponse(
      {
        error: "apply_preview_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
