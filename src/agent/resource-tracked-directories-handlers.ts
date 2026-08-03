import { getDb } from "../db/connection.js";
import { initializeSchema } from "../db/schema.js";
import {
  addResourceTrackedDirectory,
  listResourceTrackedDirectories,
  removeResourceTrackedDirectory,
  rescanResourceTrackedDirectories,
  ResourceTrackedDirectoryError,
} from "../services/resource-tracked-directories.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

function ensureDbReady(): void {
  const db = getDb();
  initializeSchema(db);
}

function trackedDirectoryErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof ResourceTrackedDirectoryError ? 400 : 500;
  return jsonResponse({ error: "tracked_directory_failed", message }, { status });
}

export function handleResourceTrackedDirectoriesList(
  request: Request,
  token: string,
): Response {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }
  ensureDbReady();
  return jsonResponse({ directories: listResourceTrackedDirectories() });
}

export async function handleResourceTrackedDirectoriesRescan(
  request: Request,
  token: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }
  ensureDbReady();

  try {
    const result = await rescanResourceTrackedDirectories();
    return jsonResponse(result);
  } catch (error) {
    return trackedDirectoryErrorResponse(error);
  }
}

export async function handleResourceTrackedDirectoryAdd(
  request: Request,
  token: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }
  ensureDbReady();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "invalid_json", message: "Request body must be JSON" },
      { status: 400 },
    );
  }

  const path = (body as { path?: unknown }).path;
  if (typeof path !== "string" || path.trim().length === 0) {
    return jsonResponse(
      { error: "invalid_path", message: "path is required" },
      { status: 400 },
    );
  }

  try {
    const result = await addResourceTrackedDirectory(path);
    return jsonResponse(result);
  } catch (error) {
    return trackedDirectoryErrorResponse(error);
  }
}

export async function handleResourceTrackedDirectoryRemove(
  request: Request,
  token: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }
  ensureDbReady();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "invalid_json", message: "Request body must be JSON" },
      { status: 400 },
    );
  }

  const path = (body as { path?: unknown }).path;
  if (typeof path !== "string" || path.trim().length === 0) {
    return jsonResponse(
      { error: "invalid_path", message: "path is required" },
      { status: 400 },
    );
  }

  try {
    removeResourceTrackedDirectory(path);
    return jsonResponse({ removed: true, path: path.trim() });
  } catch (error) {
    return trackedDirectoryErrorResponse(error);
  }
}
