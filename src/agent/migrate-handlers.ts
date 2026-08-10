import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  detectImportScopeFromFile,
  exportScopedMigration,
  importScopedMigration,
  type MigrateExportCliOpts,
  type MigrateImportCliOpts,
  type MigrateScope,
  resolveExportScope,
  resolveImportScope,
} from "../services/migrate-scope.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseJsonBody(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
}

function readJsonObject(body: unknown): Record<string, unknown> | Response {
  if (!isRecord(body)) {
    return jsonResponse({ error: "invalid_body" }, { status: 400 });
  }
  return body;
}

function isMigrateScope(value: string): value is MigrateScope {
  switch (value) {
    case "workspace":
    case "plugin":
    case "resource":
    case "environment":
      return true;
    default:
      return false;
  }
}

function clientErrorStatus(message: string): number {
  return /required|unknown|not found|cannot detect|unsupported|choose only one|looks like|provide at least/i.test(
    message,
  )
    ? 400
    : 500;
}

export async function handleMigrateDetectImportScope(
  request: Request,
  token: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  const bodyResult = await parseJsonBody(request);
  if (bodyResult instanceof Response) return bodyResult;

  const body = readJsonObject(bodyResult);
  if (body instanceof Response) return body;

  const path = body.path;
  if (typeof path !== "string" || path.trim().length === 0) {
    return jsonResponse(
      { error: "path_required", message: "path is required" },
      { status: 400 },
    );
  }

  const resolvedPath = resolve(path.trim());
  if (!existsSync(resolvedPath)) {
    return jsonResponse(
      { error: "path_not_found", message: `Path not found: ${resolvedPath}` },
      { status: 400 },
    );
  }

  try {
    const scope = detectImportScopeFromFile(resolvedPath);
    return jsonResponse({ scope });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      { error: "detect_failed", message },
      { status: clientErrorStatus(message) },
    );
  }
}

export async function handleMigrateExport(
  request: Request,
  token: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  const bodyResult = await parseJsonBody(request);
  if (bodyResult instanceof Response) return bodyResult;

  const body = readJsonObject(bodyResult);
  if (body instanceof Response) return body;

  const scopeRaw = body.scope;
  if (typeof scopeRaw !== "string" || !isMigrateScope(scopeRaw)) {
    return jsonResponse(
      {
        error: "invalid_scope",
        message: "scope must be workspace, plugin, resource, or environment",
      },
      { status: 400 },
    );
  }

  const path = body.path;
  if (typeof path !== "string" || path.trim().length === 0) {
    return jsonResponse(
      { error: "path_required", message: "path is required" },
      { status: 400 },
    );
  }

  const plugin = typeof body.plugin === "string" ? body.plugin : undefined;
  const resource = typeof body.resource === "string" ? body.resource : undefined;
  const environment =
    typeof body.environment === "string" ? body.environment : undefined;
  const includePlugins = body.include_plugins === true;

  switch (scopeRaw) {
    case "plugin":
      if (!plugin || plugin.trim().length === 0) {
        return jsonResponse(
          {
            error: "plugin_required",
            message: "plugin is required for plugin export",
          },
          { status: 400 },
        );
      }
      break;
    case "resource":
      if (!resource || resource.trim().length === 0) {
        return jsonResponse(
          {
            error: "resource_required",
            message: "resource is required for resource export",
          },
          { status: 400 },
        );
      }
      break;
    case "environment":
      if (!environment || environment.trim().length === 0) {
        return jsonResponse(
          {
            error: "environment_required",
            message: "environment is required for environment export",
          },
          { status: 400 },
        );
      }
      break;
    case "workspace":
      break;
    default: {
      const neverScope: never = scopeRaw;
      return jsonResponse(
        { error: "invalid_scope", message: `Unsupported scope: ${neverScope}` },
        { status: 400 },
      );
    }
  }

  const exportOpts: MigrateExportCliOpts = {
    file: resolve(path.trim()),
    includePlugins,
    workspace: scopeRaw === "workspace" ? true : undefined,
    plugin: scopeRaw === "plugin" ? plugin : undefined,
    resource: scopeRaw === "resource" ? resource : undefined,
    environment: scopeRaw === "environment" ? environment : undefined,
  };

  try {
    const resolved = resolveExportScope(exportOpts);
    const result = exportScopedMigration(resolved, exportOpts);
    if (result.scope === "workspace") {
      return jsonResponse({
        ...result.manifest,
        output: result.output,
        scope: result.scope,
      });
    }
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      { error: "export_failed", message },
      { status: clientErrorStatus(message) },
    );
  }
}

export async function handleMigrateImport(
  request: Request,
  token: string,
): Promise<Response> {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  const bodyResult = await parseJsonBody(request);
  if (bodyResult instanceof Response) return bodyResult;

  const body = readJsonObject(bodyResult);
  if (body instanceof Response) return body;

  const path = body.path;
  if (typeof path !== "string" || path.trim().length === 0) {
    return jsonResponse(
      { error: "path_required", message: "path is required" },
      { status: 400 },
    );
  }

  const resolvedPath = resolve(path.trim());

  const scopeRaw = body.scope;
  let forcedScope: MigrateScope | undefined;
  if (scopeRaw !== null && scopeRaw !== undefined) {
    if (typeof scopeRaw !== "string" || !isMigrateScope(scopeRaw)) {
      return jsonResponse(
        {
          error: "invalid_scope",
          message: "scope must be workspace, plugin, resource, or environment",
        },
        { status: 400 },
      );
    }
    forcedScope = scopeRaw;
  }

  const importOpts: MigrateImportCliOpts = {
    file: resolvedPath,
    workspace: forcedScope === "workspace" ? true : undefined,
    plugin: forcedScope === "plugin" ? true : undefined,
    resource: forcedScope === "resource" ? true : undefined,
    environment: forcedScope === "environment" ? true : undefined,
  };

  try {
    const scope = resolveImportScope(importOpts);
    const result = importScopedMigration(scope, resolvedPath);
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      { error: "import_failed", message },
      { status: clientErrorStatus(message) },
    );
  }
}
