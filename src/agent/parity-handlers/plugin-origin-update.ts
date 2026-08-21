import {
  checkPluginOrigins,
  updatePluginOrigins,
} from "../../services/plugin-origin-update.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

const CHECK_PATH = "/v1/plugins/check";
const UPDATE_PATH = "/v1/plugins/update";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function tryHandle(
  request: Request,
  token: string,
  _deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === CHECK_PATH && request.method === "GET") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) return authError;
    const name = readOptionalName(url.searchParams.get("name"));
    const refresh = url.searchParams.get("refresh") === "1";
    return jsonResponse(await checkPluginOrigins({ name, refresh }));
  }

  if (url.pathname === UPDATE_PATH && request.method === "POST") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) return authError;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, { status: 400 });
    }
    if (!isRecord(body)) {
      return jsonResponse({ error: "invalid_body" }, { status: 400 });
    }

    const name = readOptionalName(body.name);
    const all = body.all === true;
    const force = body.force === true;
    if (!name && !all) {
      return jsonResponse(
        { error: "invalid_body", message: "pass a name or --all" },
        { status: 400 },
      );
    }

    try {
      return jsonResponse(await updatePluginOrigins({ name, all, force }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/pass a name or --all/.test(message)) {
        return jsonResponse({ error: "invalid_body", message }, { status: 400 });
      }
      return jsonResponse({ error: "update_failed", message }, { status: 500 });
    }
  }

  return null;
}
