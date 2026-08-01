import { getDb } from "../db/connection.js";
import { initializeSchema } from "../db/schema.js";
import { resolveApplyConflictPolicy } from "../services/materialization-conflicts.js";
import {
  listProfileStashEntries,
  popProfileStashCommand,
  ProfileStashError,
  stashProfileCommand,
} from "../services/profile-stash.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

function stashErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof ProfileStashError ? 400 : 500;
  return jsonResponse({ error: "stash_failed", message }, { status });
}

function ensureDbReady(): void {
  const db = getDb();
  initializeSchema(db);
}

export function handleProfileStashList(request: Request, token: string): Response {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }
  ensureDbReady();
  return jsonResponse({ entries: listProfileStashEntries() });
}

export async function handleProfileStashPush(
  request: Request,
  token: string,
  isSwitchInProgress: () => boolean,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }
  if (isSwitchInProgress()) {
    return jsonResponse(
      {
        error: "switch_in_progress",
        message: "Another profile switch is already running",
      },
      { status: 409 },
    );
  }

  let body: Record<string, unknown> = {};
  if (request.headers.get("content-length") !== "0") {
    try {
      const parsed = await request.json();
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      return jsonResponse({ error: "invalid_json" }, { status: 400 });
    }
  }

  const harness = typeof body.harness === "string" ? body.harness : undefined;
  ensureDbReady();

  try {
    const result = await stashProfileCommand({
      harness,
      conflictPolicy: resolveApplyConflictPolicy({}),
      pull: false,
    });
    return jsonResponse(result);
  } catch (error) {
    return stashErrorResponse(error);
  }
}

export async function handleProfileStashPop(
  request: Request,
  token: string,
  isSwitchInProgress: () => boolean,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }
  if (isSwitchInProgress()) {
    return jsonResponse(
      {
        error: "switch_in_progress",
        message: "Another profile switch is already running",
      },
      { status: 409 },
    );
  }

  let body: Record<string, unknown> = {};
  if (request.headers.get("content-length") !== "0") {
    try {
      const parsed = await request.json();
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      return jsonResponse({ error: "invalid_json" }, { status: 400 });
    }
  }

  const harness = typeof body.harness === "string" ? body.harness : undefined;
  ensureDbReady();

  try {
    const result = await popProfileStashCommand({
      harness,
      conflictPolicy: resolveApplyConflictPolicy({}),
      pull: false,
    });
    return jsonResponse(result);
  } catch (error) {
    return stashErrorResponse(error);
  }
}
