import {
  getUpstreamCheckJob,
  listUpdates,
  startUpstreamCheckJob,
} from "../../services/upstream-check-runner.js";
import { dismissUpstreamUpdate } from "../../services/upstream-check.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

const JOB_PATH = /^\/v1\/updates\/check\/([^/]+)$/;
const DISMISS_PATH = /^\/v1\/updates\/([^/]+)\/dismiss$/;

/**
 * GET  /v1/updates                  the stored check, rows tagged for Desktop
 * POST /v1/updates/check            start a check now: 202 {job_id}
 * GET  /v1/updates/check/:job_id    job state (running, done, failed)
 * POST /v1/updates/:plugin/dismiss  "Not now", body {version?}
 */
export async function tryHandle(
  request: Request,
  token: string,
  _deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (!pathname.startsWith("/v1/updates")) return null;

  if (pathname === "/v1/updates" && request.method === "GET") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) return authError;
    return jsonResponse(listUpdates());
  }

  if (pathname === "/v1/updates/check" && request.method === "POST") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) return authError;
    const { job } = startUpstreamCheckJob();
    return jsonResponse({ job_id: job.job_id, state: job.state }, { status: 202 });
  }

  const jobMatch = pathname.match(JOB_PATH);
  if (jobMatch && request.method === "GET") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) return authError;
    const job = getUpstreamCheckJob(decodeURIComponent(jobMatch[1] ?? ""));
    if (!job) return jsonResponse({ error: "not_found" }, { status: 404 });
    return jsonResponse(job);
  }

  const dismissMatch = pathname.match(DISMISS_PATH);
  if (dismissMatch && request.method === "POST") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) return authError;
    let body: unknown = {};
    const text = await request.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return jsonResponse({ error: "invalid_json" }, { status: 400 });
      }
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return jsonResponse({ error: "invalid_body" }, { status: 400 });
    }
    const version = (body as { version?: unknown }).version;
    if (version !== undefined && (typeof version !== "string" || !version.trim())) {
      return jsonResponse({ error: "invalid_body" }, { status: 400 });
    }
    const plugin = decodeURIComponent(dismissMatch[1] ?? "");
    try {
      dismissUpstreamUpdate(plugin, typeof version === "string" ? version.trim() : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: "not_found", message }, { status: 404 });
    }
    return jsonResponse(listUpdates());
  }

  return null;
}
