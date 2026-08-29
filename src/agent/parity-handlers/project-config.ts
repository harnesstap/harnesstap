import { readFileSync, writeFileSync } from "node:fs";
import {
  evaluateProjectConfigContents,
  findProjectConfig,
  locateProjectManifest,
  validateProjectConfig,
  type ResolvedProjectConfig,
} from "../../services/project-config.js";
import { MISSING_PROJECT_CONFIG_MESSAGE } from "../../services/project-config-messages.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";
import { isAgentApplyInProgress } from "./apply.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readProjectPathFromQuery(url: URL): string {
  return (url.searchParams.get("projectPath") ?? url.searchParams.get("project") ?? "").trim();
}

function missingProjectPath(): Response {
  return jsonResponse({ error: "projectPath_required" }, { status: 400 });
}

function configNotFound(): Response {
  return jsonResponse(
    { error: "config_not_found", message: MISSING_PROJECT_CONFIG_MESSAGE },
    { status: 404 },
  );
}

async function handleInspectGet(url: URL): Promise<Response> {
  const projectPath = readProjectPathFromQuery(url);
  if (!projectPath) {
    return missingProjectPath();
  }

  let config: ResolvedProjectConfig | null;
  try {
    config = findProjectConfig(projectPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: "invalid_config", message }, { status: 400 });
  }

  if (!config) {
    return configNotFound();
  }

  return jsonResponse({
    config: summarizeConfigForJson(config),
    validation: validateProjectConfig(config),
  });
}

async function handleRawGet(url: URL): Promise<Response> {
  const projectPath = readProjectPathFromQuery(url);
  if (!projectPath) {
    return missingProjectPath();
  }

  const located = locateProjectManifest(projectPath);
  if (!located) {
    return configNotFound();
  }

  const contents = readFileSync(located.configPath, "utf-8");
  const evaluated = evaluateProjectConfigContents(
    contents,
    located.configPath,
    located.rootPath,
  );
  return jsonResponse({
    path: located.configPath,
    contents,
    validation: evaluated.ok
      ? evaluated.validation
      : { valid: false, errors: evaluated.errors },
  });
}

async function handleRawPut(
  request: Request,
  deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response> {
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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
  if (!isRecord(raw)) {
    return jsonResponse({ error: "invalid_body", message: "Body must be a JSON object" }, { status: 400 });
  }
  if (typeof raw.projectPath !== "string" || raw.projectPath.trim().length === 0) {
    return missingProjectPath();
  }
  if (typeof raw.contents !== "string") {
    return jsonResponse(
      { error: "invalid_body", message: "contents must be a string" },
      { status: 400 },
    );
  }

  const projectPath = raw.projectPath.trim();
  const located = locateProjectManifest(projectPath);
  if (!located) {
    return configNotFound();
  }

  const evaluated = evaluateProjectConfigContents(
    raw.contents,
    located.configPath,
    located.rootPath,
  );
  if (!evaluated.ok) {
    return jsonResponse(
      {
        error: "invalid_config",
        message: "apm.yml failed validation",
        validation: { valid: false, errors: evaluated.errors },
      },
      { status: 400 },
    );
  }

  writeFileSync(located.configPath, raw.contents, "utf-8");
  const config = findProjectConfig(projectPath);
  return jsonResponse({
    path: located.configPath,
    contents: raw.contents,
    config: config ? summarizeConfigForJson(config) : undefined,
    validation: evaluated.validation,
  });
}

export async function tryHandle(
  request: Request,
  token: string,
  deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const isInspect = method === "GET" && url.pathname === "/v1/config";
  const isRawGet = method === "GET" && url.pathname === "/v1/config/raw";
  const isRawPut = method === "PUT" && url.pathname === "/v1/config/raw";
  if (!isInspect && !isRawGet && !isRawPut) {
    return null;
  }

  try {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) return authError;

    if (isInspect) {
      return await handleInspectGet(url);
    }
    if (isRawGet) {
      return await handleRawGet(url);
    }
    return await handleRawPut(request, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: "config_inspect_failed", message }, { status: 500 });
  }
}

export function summarizeConfigForJson(config: ResolvedProjectConfig) {
  return {
    root_path: config.rootPath,
    config_path: config.configPath,
    name: config.apm_name,
    version: config.apm_version,
    default_profile: config.default_profile,
    default_environment: config.default_environment,
    targets: config.harnessTargets,
    skipped_targets: config.skippedTargets,
    profiles: config.profiles,
    environments: config.environments,
    plugins: config.plugins.map((plugin) => ({ name: plugin.name })),
    environment_count: config.environments.length,
    plugin_count: config.plugins.length,
    apm_dependencies: config.apmDependencies.map((dependency) => ({
      name: dependency.name,
      source: dependency.sourceKind,
      selector: dependency.applySelector,
      ...(dependency.ref ? { ref: dependency.ref } : {}),
      ...(dependency.path ? { path: dependency.path } : {}),
    })),
    mcp_dependencies: config.mcpDependencies.map((dependency) => ({
      name: dependency.name,
      ...(dependency.registryId ? { registry_id: dependency.registryId } : {}),
    })),
    warnings: config.warnings,
  };
}
