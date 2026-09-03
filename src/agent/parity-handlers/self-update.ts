import {
  applyDesktopUpdate,
  resolveDesktopUpdateStatus,
} from "../../services/self-update.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

const STATUS_PATH = "/v1/app-update";
const APPLY_PATH = "/v1/app-update/apply";

export async function tryHandle(
  request: Request,
  token: string,
  _deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === STATUS_PATH && request.method === "GET") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) return authError;
    try {
      return jsonResponse(await resolveDesktopUpdateStatus());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: "update_check_failed", message }, { status: 500 });
    }
  }

  if (url.pathname === APPLY_PATH && request.method === "POST") {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) return authError;
    try {
      return jsonResponse(await applyDesktopUpdate());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: "update_apply_failed", message }, { status: 500 });
    }
  }

  return null;
}
