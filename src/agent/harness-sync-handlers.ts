import {
  HarnessUnionSyncError,
  syncConfiguredHarnesses,
} from "../services/harness-union-sync.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

export async function handleHarnessSyncPost(
  request: Request,
  token: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  let body: unknown = {};
  const raw = await request.text();
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonResponse(
        { error: "invalid_json", message: "Request body must be JSON" },
        { status: 400 },
      );
    }
  }

  if (body !== null && typeof body !== "object") {
    return jsonResponse(
      { error: "invalid_body", message: "Request body must be an object" },
      { status: 400 },
    );
  }

  const record = (body ?? {}) as Record<string, unknown>;
  const project =
    typeof record.project === "string" && record.project.trim()
      ? record.project.trim()
      : undefined;
  const dryRun = record.dry_run === true;

  try {
    const result = await syncConfiguredHarnesses({
      scope: project ? "project" : "global",
      ...(project ? { projectRoot: project } : {}),
      dryRun,
    });
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof HarnessUnionSyncError) {
      switch (error.code) {
        case "need_two_harnesses":
        case "no_main_harness":
          return jsonResponse(
            { error: error.code, message: error.message },
            { status: 400 },
          );
        default: {
          const exhaustive: never = error.code;
          return exhaustive;
        }
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: "harness_sync_failed", message }, { status: 500 });
  }
}
