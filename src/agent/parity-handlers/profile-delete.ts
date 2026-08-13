import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { deletePlugin } from "../../models/plugin-model.js";
import {
  ProfileReservedNameError,
  deleteProfileCommand,
} from "../../services/profile-commands.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapDeleteError(error: unknown): Response {
  if (error instanceof ProfileReservedNameError) {
    return jsonResponse(
      { error: "reserved_name", message: error.message },
      { status: 400 },
    );
  }
  const message = errorMessage(error);
  if (message.startsWith("Profile not found:")) {
    return jsonResponse({ error: "not_found", message }, { status: 404 });
  }
  if (message.includes("is not tagged as a profile")) {
    return jsonResponse({ error: "not_a_profile", message }, { status: 400 });
  }
  return jsonResponse({ error: "delete_failed", message }, { status: 500 });
}

async function parseDeletePluginFlag(
  request: Request,
): Promise<boolean | Response> {
  const raw = await request.text();
  if (raw.trim() === "") {
    return false;
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse(
      { error: "invalid_body", message: "Body must be JSON" },
      { status: 400 },
    );
  }
  if (!isRecord(body)) {
    return jsonResponse(
      { error: "invalid_body", message: "Body must be a JSON object" },
      { status: 400 },
    );
  }
  if (body.deletePlugin === undefined) {
    return false;
  }
  if (typeof body.deletePlugin !== "boolean") {
    return jsonResponse(
      { error: "invalid_body", message: "deletePlugin must be a boolean" },
      { status: 400 },
    );
  }
  return body.deletePlugin;
}

export async function tryHandle(
  request: Request,
  token: string,
  deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/v1\/profiles\/([^/]+)$/);
    if (request.method !== "DELETE" || !match) {
      return null;
    }

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

    const name = decodeURIComponent(match[1] ?? "");
    const deletePluginFlag = await parseDeletePluginFlag(request);
    if (deletePluginFlag instanceof Response) {
      return deletePluginFlag;
    }

    initializeSchema(getDb());

    const demoted = deleteProfileCommand(name);
    let pluginDeleted = false;
    if (deletePluginFlag) {
      pluginDeleted = deletePlugin(demoted.plugin_id);
      if (!pluginDeleted) {
        return jsonResponse(
          {
            error: "delete_failed",
            message: `Demoted profile ${demoted.plugin_name} but failed to delete the plugin row`,
          },
          { status: 500 },
        );
      }
    }

    return jsonResponse({
      plugin_id: demoted.plugin_id,
      plugin_name: demoted.plugin_name,
      tags: demoted.tags,
      was_active: demoted.was_active,
      plugin_deleted: pluginDeleted,
    });
  } catch (error) {
    return mapDeleteError(error);
  }
}
