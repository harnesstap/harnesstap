import {
  writeProjectExecutableGrant,
} from "../../services/executable-trust.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";
import { isAgentApplyInProgress } from "./apply.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type GrantSide = "allow" | "deny";

interface ParsedGrantBody {
  projectPath: string;
  refs: string[];
}

function parseBody(body: unknown): ParsedGrantBody | Response {
  if (!isRecord(body)) {
    return jsonResponse({ error: "invalid_body", message: "Body must be a JSON object" }, { status: 400 });
  }
  if (typeof body.projectPath !== "string" || body.projectPath.trim().length === 0) {
    return jsonResponse(
      { error: "missing_project_path", message: "projectPath is required" },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.refs)) {
    return jsonResponse(
      { error: "invalid_refs", message: "refs must be an array of strings" },
      { status: 400 },
    );
  }
  const refs: string[] = [];
  for (const entry of body.refs) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      return jsonResponse(
        { error: "invalid_refs", message: "refs must be an array of strings" },
        { status: 400 },
      );
    }
    refs.push(entry.trim());
  }
  if (refs.length === 0) {
    return jsonResponse(
      { error: "invalid_refs", message: "refs must include at least one package ref" },
      { status: 400 },
    );
  }
  return {
    projectPath: body.projectPath.trim(),
    refs,
  };
}

function matchGrantPath(pathname: string): GrantSide | null {
  switch (pathname) {
    case "/v1/approve":
      return "allow";
    case "/v1/deny":
      return "deny";
    default:
      return null;
  }
}

export async function tryHandle(
  request: Request,
  token: string,
  deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  const url = new URL(request.url);
  const side = matchGrantPath(url.pathname);
  if (request.method !== "POST" || side === null) {
    return null;
  }

  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseBody(raw);
  if (parsed instanceof Response) {
    return parsed;
  }

  if (deps.isAgentSwitchInProgress()) {
    return jsonResponse(
      { error: "switch_in_progress", message: "Another profile switch is already running" },
      { status: 409 },
    );
  }
  if (isAgentApplyInProgress()) {
    return jsonResponse(
      { error: "apply_in_progress", message: "Another apply is already running" },
      { status: 409 },
    );
  }

  try {
    writeProjectExecutableGrant({
      projectRoot: parsed.projectPath,
      side,
      refs: parsed.refs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: "grant_failed", message }, { status: 400 });
  }

  return jsonResponse({
    written: "project",
    side,
    refs: parsed.refs,
    project_path: parsed.projectPath,
  });
}
