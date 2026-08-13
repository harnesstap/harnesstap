import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { resolveApplyConflictPolicy } from "../../services/materialization-conflicts.js";
import {
  applyProfileStashCommand,
  ProfileStashError,
} from "../../services/profile-stash.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

function stashErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof ProfileStashError ? 400 : 500;
  return jsonResponse({ error: "stash_failed", message }, { status });
}

function ensureDbReady(): void {
  const db = getDb();
  initializeSchema(db);
}

export async function tryHandle(
  request: Request,
  token: string,
  deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method.toUpperCase() !== "POST" || url.pathname !== "/v1/profiles/stash/apply") {
    return null;
  }

  try {
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
    const result = await applyProfileStashCommand({
      harness,
      conflictPolicy: resolveApplyConflictPolicy({}),
      pull: false,
    });
    return jsonResponse(result);
  } catch (error) {
    return stashErrorResponse(error);
  }
}
