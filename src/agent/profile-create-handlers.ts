import {
  ProfileRenameError,
  ProfileReservedNameError,
  renameProfileCommand,
  tagProfileCommand,
} from "../services/profile-commands.js";
import {
  commitProfileCreate,
  type ProfileConflictPolicy,
  type ProfileCreateInput,
  type ProfileCreateSource,
  ProfilePluginExistsError,
  previewProfileCreate,
} from "../services/profile-create.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSource(value: unknown): ProfileCreateSource | undefined {
  if (value === "compose" || value === "home" || value === "project") {
    return value;
  }
  return undefined;
}

function parseConflictPolicy(
  value: unknown,
): ProfileConflictPolicy | undefined {
  if (value === "skip" || value === "overwrite") {
    return value;
  }
  return undefined;
}

function parseOptionalString(
  body: Record<string, unknown>,
  key: string,
): string | Response | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return jsonResponse(
      { error: "invalid_body", message: `${key} must be a string` },
      { status: 400 },
    );
  }
  return value;
}

function parseOptionalBoolean(
  body: Record<string, unknown>,
  key: string,
): boolean | Response | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    return jsonResponse(
      { error: "invalid_body", message: `${key} must be a boolean` },
      { status: 400 },
    );
  }
  return value;
}

function parseOptionalStringArray(
  body: Record<string, unknown>,
  key: string,
): string[] | Response | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return jsonResponse(
      { error: "invalid_body", message: `${key} must be an array of strings` },
      { status: 400 },
    );
  }
  return value;
}

function parseProfileCreateInput(body: unknown): ProfileCreateInput | Response {
  if (!isRecord(body)) {
    return jsonResponse({ error: "invalid_body" }, { status: 400 });
  }

  const source = parseSource(body.source);
  if (!source) {
    return jsonResponse({ error: "invalid_source" }, { status: 400 });
  }
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return jsonResponse({ error: "invalid_name" }, { status: 400 });
  }

  const name = body.name.trim();
  const description = parseOptionalString(body, "description");
  if (description instanceof Response) {
    return description;
  }
  const use = parseOptionalBoolean(body, "use");
  if (use instanceof Response) {
    return use;
  }

  switch (source) {
    case "compose": {
      const pluginIds = parseOptionalStringArray(body, "pluginIds");
      if (pluginIds instanceof Response) {
        return pluginIds;
      }
      const resourceIds = parseOptionalStringArray(body, "resourceIds");
      if (resourceIds instanceof Response) {
        return resourceIds;
      }
      return {
        source,
        name,
        ...(description !== undefined ? { description } : {}),
        ...(pluginIds !== undefined ? { pluginIds } : {}),
        ...(resourceIds !== undefined ? { resourceIds } : {}),
        ...(use !== undefined ? { use } : {}),
      };
    }
    case "home": {
      const conflictPolicy = parseConflictPolicy(body.conflictPolicy);
      if (!conflictPolicy) {
        return jsonResponse(
          { error: "invalid_conflict_policy" },
          { status: 400 },
        );
      }
      const platform = parseOptionalString(body, "platform");
      if (platform instanceof Response) {
        return platform;
      }
      return {
        source,
        name,
        ...(description !== undefined ? { description } : {}),
        conflictPolicy,
        ...(platform !== undefined ? { platform } : {}),
        ...(use !== undefined ? { use } : {}),
      };
    }
    case "project": {
      if (
        typeof body.projectPath !== "string"
        || body.projectPath.trim().length === 0
      ) {
        return jsonResponse(
          { error: "projectPath_required" },
          { status: 400 },
        );
      }
      const conflictPolicy = parseConflictPolicy(body.conflictPolicy);
      if (!conflictPolicy) {
        return jsonResponse(
          { error: "invalid_conflict_policy" },
          { status: 400 },
        );
      }
      const platform = parseOptionalString(body, "platform");
      if (platform instanceof Response) {
        return platform;
      }
      return {
        source,
        name,
        ...(description !== undefined ? { description } : {}),
        projectPath: body.projectPath,
        conflictPolicy,
        ...(platform !== undefined ? { platform } : {}),
        ...(use !== undefined ? { use } : {}),
      };
    }
    default: {
      const exhaustiveSource: never = source;
      return exhaustiveSource;
    }
  }
}

async function parseRequestInput(
  request: Request,
): Promise<ProfileCreateInput | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
  return parseProfileCreateInput(body);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handleProfileCreatePreview(
  request: Request,
  token: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }
  const input = await parseRequestInput(request);
  if (input instanceof Response) {
    return input;
  }
  try {
    return jsonResponse(await previewProfileCreate(input));
  } catch (error) {
    return jsonResponse(
      { error: "preview_failed", message: errorMessage(error) },
      { status: 400 },
    );
  }
}

export async function handleProfileCreate(
  request: Request,
  token: string,
  isSwitchInProgress: () => boolean,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }
  if (isSwitchInProgress()) {
    return jsonResponse({ error: "switch_in_progress" }, { status: 409 });
  }
  const input = await parseRequestInput(request);
  if (input instanceof Response) {
    return input;
  }
  try {
    return jsonResponse(await commitProfileCreate(input), { status: 201 });
  } catch (error) {
    if (error instanceof ProfileReservedNameError) {
      return jsonResponse(
        { error: "reserved_name", message: error.message },
        { status: 400 },
      );
    }
    if (
      error instanceof ProfilePluginExistsError
      || errorMessage(error).startsWith("Plugin already exists:")
    ) {
      return jsonResponse({ error: "plugin_exists" }, { status: 409 });
    }
    return jsonResponse(
      { error: "create_failed", message: errorMessage(error) },
      { status: 400 },
    );
  }
}

export function handleProfileTag(
  request: Request,
  token: string,
  name: string,
): Response {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }
  try {
    return jsonResponse(tagProfileCommand(name));
  } catch (error) {
    return jsonResponse(
      { error: "not_found", message: errorMessage(error) },
      { status: 404 },
    );
  }
}

export async function handleProfileRename(
  request: Request,
  token: string,
  name: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_body" }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.name !== "string") {
    return jsonResponse(
      { error: "invalid_body", message: "name must be a string" },
      { status: 400 },
    );
  }

  try {
    return jsonResponse(renameProfileCommand(name, body.name));
  } catch (error) {
    if (error instanceof ProfileRenameError) {
      switch (error.code) {
        case "invalid_name":
          return jsonResponse({ error: "invalid_name" }, { status: 400 });
        case "not_found":
          return jsonResponse(
            { error: "not_found", message: error.message },
            { status: 404 },
          );
        case "plugin_exists":
          return jsonResponse({ error: "plugin_exists" }, { status: 409 });
        case "not_a_profile":
          return jsonResponse(
            { error: "not_a_profile", message: error.message },
            { status: 400 },
          );
        case "reserved_name":
          return jsonResponse(
            { error: "reserved_name", message: error.message },
            { status: 400 },
          );
        default: {
          const _exhaustive: never = error.code;
          void _exhaustive;
          return jsonResponse(
            { error: "rename_failed", message: error.message },
            { status: 400 },
          );
        }
      }
    }
    return jsonResponse(
      { error: "rename_failed", message: errorMessage(error) },
      { status: 400 },
    );
  }
}
