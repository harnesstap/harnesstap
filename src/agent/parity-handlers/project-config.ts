import {
  findProjectConfig,
  validateProjectConfig,
  type ResolvedProjectConfig,
} from "../../services/project-config.js";
import { MISSING_PROJECT_CONFIG_MESSAGE } from "../../services/project-config-messages.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

export async function tryHandle(
  request: Request,
  token: string,
  _deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/v1/config") {
    return null;
  }

  try {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) return authError;

    const projectPath =
      (url.searchParams.get("projectPath") ?? url.searchParams.get("project") ?? "").trim();
    if (!projectPath) {
      return jsonResponse({ error: "projectPath_required" }, { status: 400 });
    }

    let config: ResolvedProjectConfig | null;
    try {
      config = findProjectConfig(projectPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: "invalid_config", message }, { status: 400 });
    }

    if (!config) {
      return jsonResponse(
        { error: "config_not_found", message: MISSING_PROJECT_CONFIG_MESSAGE },
        { status: 404 },
      );
    }

    return jsonResponse({
      config: summarizeConfigForJson(config),
      validation: validateProjectConfig(config),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: "config_inspect_failed", message }, { status: 500 });
  }
}

export function summarizeConfigForJson(config: ResolvedProjectConfig) {
  return {
    root_path: config.rootPath,
    config_path: config.configPath,
    default_profile: config.default_profile,
    default_environment: config.default_environment,
    profiles: config.profiles,
    environments: config.environments,
    plugins: config.plugins.map((plugin) => ({ name: plugin.name })),
    environment_count: config.environments.length,
    plugin_count: config.plugins.length,
  };
}
