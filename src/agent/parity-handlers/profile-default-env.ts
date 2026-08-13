import { getEnvironment } from "../../models/environment.js";
import { resolvePluginSelector } from "../../models/plugin-model.js";
import {
  setPluginEnvironmentCommand,
  unsetPluginEnvironmentCommand,
} from "../../services/environment-commands.js";
import { getProfileDetail } from "../../services/profile-edit.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";
import { profileEditErrorResponse } from "../profile-edit-handlers.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function environmentCommandErrorResponse(error: unknown): Response {
  const message = errorMessage(error);
  if (message.startsWith("Environment not found:")) {
    return jsonResponse(
      { error: "environment_not_found", message },
      { status: 404 },
    );
  }
  if (message.startsWith("Environment selector is ambiguous:")) {
    return jsonResponse(
      { error: "ambiguous_environment", message },
      { status: 400 },
    );
  }
  return profileEditErrorResponse(error);
}

function readDefaultEnvironmentName(profileName: string): string | null {
  const detail = getProfileDetail(profileName);
  const plugin = resolvePluginSelector(detail.profile.name);
  const environmentId = plugin?.default_environment_id ?? null;
  if (!environmentId) {
    return null;
  }
  return getEnvironment(environmentId)?.name ?? null;
}

function matchDefaultEnvironmentPath(pathname: string): string | null {
  const match = pathname.match(/^\/v1\/profiles\/([^/]+)\/default-environment$/);
  if (!match) {
    return null;
  }
  return decodeURIComponent(match[1] ?? "");
}

export async function tryHandle(
  request: Request,
  token: string,
  _deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  const url = new URL(request.url);
  const name = matchDefaultEnvironmentPath(url.pathname);
  if (name === null) {
    return null;
  }

  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "PATCH") {
    return null;
  }

  try {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }

    if (method === "GET") {
      return jsonResponse({
        defaultEnvironment: readDefaultEnvironmentName(name),
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, { status: 400 });
    }
    if (!isRecord(body) || !Object.hasOwn(body, "defaultEnvironment")) {
      return jsonResponse(
        {
          error: "invalid_body",
          message: "Provide defaultEnvironment to update",
        },
        { status: 400 },
      );
    }

    const defaultEnvironment = body.defaultEnvironment;
    if (defaultEnvironment === null) {
      unsetPluginEnvironmentCommand(name);
      return jsonResponse({
        defaultEnvironment: readDefaultEnvironmentName(name),
      });
    }
    if (typeof defaultEnvironment !== "string" || defaultEnvironment.length === 0) {
      return jsonResponse(
        {
          error: "invalid_body",
          message: "defaultEnvironment must be a non-empty string or null",
        },
        { status: 400 },
      );
    }

    setPluginEnvironmentCommand(name, defaultEnvironment);
    return jsonResponse({
      defaultEnvironment: readDefaultEnvironmentName(name),
    });
  } catch (error) {
    return environmentCommandErrorResponse(error);
  }
}
