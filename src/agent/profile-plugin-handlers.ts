import { homedir } from "node:os";
import { getHarnesstapDir } from "../db/connection.js";
import { addPluginFromMarketplace } from "../services/plugin-marketplace-add.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

export async function handleProfilePluginAdd(
  request: Request,
  token: string,
  profileName: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: "invalid_json", message: "Request body must be JSON" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse(
      { error: "invalid_body", message: "Request body must be an object" },
      { status: 400 },
    );
  }
  const record = body as Record<string, unknown>;
  if (typeof record.ref !== "string" || !record.ref.trim()) {
    return jsonResponse(
      { error: "invalid_ref", message: "ref is required" },
      { status: 400 },
    );
  }

  const name = decodeURIComponent(profileName);
  const projectRoot =
    typeof record.projectPath === "string" && record.projectPath.trim()
      ? record.projectPath.trim()
      : process.cwd();

  try {
    const result = await addPluginFromMarketplace({
      harnesstapDir: getHarnesstapDir(),
      homeRoot: process.env.HOME ?? homedir(),
      projectRoot,
      ref: record.ref.trim(),
      layerName: name,
      ...(typeof record.versionConstraint === "string"
        ? { versionConstraint: record.versionConstraint }
        : {}),
    });
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse(
      {
        error: "plugin_pin_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
