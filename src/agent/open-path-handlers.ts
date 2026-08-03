import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { openPathInSystemEditor } from "../services/open-path.js";
import {
  resolveEditorPath,
  resolveResourceEditorPath,
} from "../services/resource-editor-path.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expandUserPath(candidate: string): string {
  const trimmed = candidate.trim();
  if (trimmed.startsWith("~/")) {
    return join(resolveHomeRoot(), trimmed.slice(2));
  }
  if (trimmed === "~") {
    return resolveHomeRoot();
  }
  return resolve(trimmed);
}

function resolveOpenableDirectory(path: string): string | null {
  const expanded = expandUserPath(path);
  if (!existsSync(expanded)) {
    return null;
  }
  try {
    return statSync(expanded).isDirectory() ? expanded : null;
  } catch {
    return null;
  }
}

export async function handleOpenPath(
  request: Request,
  token: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return jsonResponse({ error: "invalid_body" }, { status: 400 });
  }

  const selector = body.selector;
  const path = body.path;
  const pathHint = body.pathHint;

  if (typeof selector === "string" && selector.trim().length > 0) {
    try {
      const resolvedPath = resolveResourceEditorPath({
        selector: selector.trim(),
        pathHint: typeof pathHint === "string" ? pathHint : null,
      });
      openPathInSystemEditor(resolvedPath);
      return jsonResponse({ path: resolvedPath });
    } catch (error) {
      return jsonResponse(
        {
          error: "open_path_failed",
          message: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      );
    }
  }

  if (typeof path === "string" && path.trim().length > 0) {
    try {
      const directoryPath = resolveOpenableDirectory(path.trim());
      if (directoryPath) {
        openPathInSystemEditor(directoryPath);
        return jsonResponse({ path: directoryPath });
      }
      const resolvedPath = resolveEditorPath(path.trim());
      openPathInSystemEditor(resolvedPath);
      return jsonResponse({ path: resolvedPath });
    } catch (error) {
      return jsonResponse(
        {
          error: "open_path_failed",
          message: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      );
    }
  }

  return jsonResponse(
    {
      error: "invalid_request",
      message: "selector or path is required",
    },
    { status: 400 },
  );
}
