import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";
import { GIT_ORIGIN_HINTS } from "../../cli/shared.js";
import { getProject, getProjectByOrigin } from "../../models/project.js";
import { getSnapshot, listSnapshots } from "../../models/snapshot.js";
import { writeFiles } from "../../services/applier.js";
import { getGitOrigin, normalizeGitUrl } from "../../services/git.js";
import type { Snapshot } from "../../types.js";

const HISTORY_PATH = "/v1/project/history";
const REVERT_PATH = "/v1/project/revert";

export async function tryHandle(
  request: Request,
  token: string,
  deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  try {
    if (request.method === "GET" && pathname === HISTORY_PATH) {
      return handleHistoryGet(request);
    }
    if (request.method === "POST" && pathname === REVERT_PATH) {
      return handleRevertPost(request, token, deps);
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: "internal_error", message }, { status: 500 });
  }
}

function noGitOriginResponse(): Response {
  return jsonResponse(
    {
      error: "no_git_origin",
      message: "No git remote origin configured.",
      hints: [...GIT_ORIGIN_HINTS],
    },
    { status: 400 },
  );
}

function flattenPlatformFiles(
  platformFiles: Record<string, Record<string, string>>,
): Array<{ path: string; content: string }> {
  return Object.entries(platformFiles).flatMap(([, files]) =>
    Object.entries(files).map(([path, content]) => ({ path, content })),
  );
}

function toHistoryRow(snapshot: Snapshot): {
  id: string;
  created_at: string;
  label: string;
  file_count: number;
} {
  return {
    id: snapshot.id,
    created_at: snapshot.created_at,
    label: snapshot.label,
    file_count: flattenPlatformFiles(snapshot.state.platform_files).length,
  };
}

function handleHistoryGet(request: Request): Response {
  const projectPath = new URL(request.url).searchParams.get("projectPath")?.trim() ?? "";
  if (!projectPath) {
    return jsonResponse(
      { error: "project_path_required", message: "projectPath is required" },
      { status: 400 },
    );
  }
  const gitOrigin = getGitOrigin(projectPath);
  if (!gitOrigin) {
    return noGitOriginResponse();
  }
  const project = getProjectByOrigin(normalizeGitUrl(gitOrigin));
  if (!project) {
    return jsonResponse({ snapshots: [], project_linked: false });
  }
  return jsonResponse({
    snapshots: listSnapshots(project.id).map(toHistoryRow),
    project_linked: true,
  });
}

async function handleRevertPost(
  request: Request,
  token: string,
  deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }
  if (deps.isAgentSwitchInProgress()) {
    return jsonResponse(
      {
        error: "switch_in_progress",
        message: "Another profile switch is already running",
      },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return jsonResponse(
      { error: "invalid_body", message: "snapshotId and projectPath are required" },
      { status: 400 },
    );
  }
  const record = body as Record<string, unknown>;
  const snapshotId = typeof record.snapshotId === "string" ? record.snapshotId.trim() : "";
  const projectPath = typeof record.projectPath === "string" ? record.projectPath.trim() : "";
  if (!snapshotId || !projectPath) {
    return jsonResponse(
      { error: "invalid_body", message: "snapshotId and projectPath are required" },
      { status: 400 },
    );
  }

  const gitOrigin = getGitOrigin(projectPath);
  if (!gitOrigin) {
    return noGitOriginResponse();
  }

  const snapshot = getSnapshot(snapshotId);
  if (!snapshot) {
    return jsonResponse(
      { error: "snapshot_not_found", message: `Snapshot not found: ${snapshotId}` },
      { status: 404 },
    );
  }
  const project = getProject(snapshot.project_id);
  if (!project) {
    return jsonResponse(
      { error: "snapshot_project_not_found", message: "Snapshot project not found." },
      { status: 404 },
    );
  }
  if (normalizeGitUrl(project.git_origin) !== normalizeGitUrl(gitOrigin)) {
    return jsonResponse(
      {
        error: "snapshot_project_mismatch",
        message: "Snapshot does not belong to this project.",
      },
      { status: 409 },
    );
  }

  const files = flattenPlatformFiles(snapshot.state.platform_files);
  writeFiles(files, project.local_path);
  return jsonResponse({
    restored_file_count: files.length,
    snapshot: {
      id: snapshot.id,
      created_at: snapshot.created_at,
      label: snapshot.label,
    },
  });
}
