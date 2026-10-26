import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";
import { getSnapshot, listSnapshots } from "../../models/snapshot.js";
import { executeRevert, resolveRevertPlan } from "../../services/snapshot-revert.js";
import { getProject } from "../../models/project.js";
import { findProjectForRoot } from "../../services/project-identity.js";
import type { Snapshot } from "../../types.js";

const HISTORY_PATH = "/v1/project/history";
const REVERT_PATH = "/v1/project/revert";
/** Revert any apply snapshot, project or global: Desktop's View snapshot dialog. */
const SNAPSHOT_REVERT_PATH = "/v1/revert";

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
    if (request.method === "POST" && pathname === SNAPSHOT_REVERT_PATH) {
      return handleSnapshotRevertPost(request, token, deps);
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: "internal_error", message }, { status: 500 });
  }
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
  // Projects without a git remote are keyed by folder (services/project-identity.ts).
  const project = findProjectForRoot(projectPath);
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

  const snapshot = getSnapshot(snapshotId);
  if (!snapshot) {
    return jsonResponse(
      { error: "snapshot_not_found", message: `Snapshot not found: ${snapshotId}` },
      { status: 404 },
    );
  }
  if (!getProject(snapshot.project_id)) {
    return jsonResponse(
      { error: "snapshot_project_not_found", message: "Snapshot project not found." },
      { status: 404 },
    );
  }
  const project = findProjectForRoot(projectPath);
  if (!project || project.id !== snapshot.project_id) {
    return jsonResponse(
      {
        error: "snapshot_project_mismatch",
        message: "Snapshot does not belong to this project.",
      },
      { status: 409 },
    );
  }

  const plan = resolveRevertPlan(snapshot.id);
  if ("error" in plan) {
    return jsonResponse({ error: "snapshot_not_found", message: plan.error }, { status: 404 });
  }
  const result = executeRevert(plan);
  return jsonResponse({
    restored_file_count: result.restored.length,
    removed_file_count: result.removed.length,
    skipped: result.skipped,
    snapshot: {
      id: snapshot.id,
      created_at: snapshot.created_at,
      label: snapshot.label,
    },
  });
}

async function handleSnapshotRevertPost(
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
  const snapshotId =
    typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).snapshotId === "string"
      ? ((body as Record<string, unknown>).snapshotId as string).trim()
      : "";
  if (!snapshotId) {
    return jsonResponse(
      { error: "invalid_body", message: "snapshotId is required" },
      { status: 400 },
    );
  }
  const plan = resolveRevertPlan(snapshotId);
  if ("error" in plan) {
    return jsonResponse(
      { error: "snapshot_not_found", message: `Snapshot not found: ${snapshotId}` },
      { status: 404 },
    );
  }
  // Same safety as the CLI revert: unowned and edited files are skipped, never
  // overwritten, and nothing is force-removed.
  const result = executeRevert(plan);
  return jsonResponse({
    kind: plan.kind,
    restored_file_count: result.restored.length,
    removed_file_count: result.removed.length,
    skipped_file_count: result.skipped.filter((entry) => entry.reason !== "missing").length,
    snapshot: { id: plan.id, created_at: plan.createdAt, label: plan.label },
  });
}
