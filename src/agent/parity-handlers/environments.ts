import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  getEnvironmentByName,
  hasEnvironmentReferences,
  listEnvironmentReferences,
} from "../../models/environment.js";
import { setPluginDefaultEnvironment } from "../../models/plugin-model.js";
import {
  deleteEnvironmentCommand,
  listEnvironmentsCommand,
  setEnvironmentModelConfigCommand,
  setEnvironmentPermissionCommand,
  setEnvironmentSecretCommand,
  setEnvironmentVarCommand,
  showEnvironmentCommand,
  unsetEnvironmentModelConfigCommand,
  unsetEnvironmentPermissionCommand,
  unsetEnvironmentSecretCommand,
  unsetEnvironmentVarCommand,
  useEnvironmentCommand,
  type EnvironmentShowPayload,
} from "../../services/environment-commands.js";
import { runEnvironmentCreate } from "../../services/environment-create.js";
import { getGlobalActiveEnvironmentName } from "../../services/environment-session.js";
import { detectEnvironmentStatus } from "../../services/environment-status.js";
import type { EnvironmentSecretProvider, PermissionMetadata } from "../../types.js";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";

export async function tryHandle(
  request: Request,
  token: string,
  deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  const url = new URL(request.url);
  const parsed = parseEnvironmentRoute(request.method, url.pathname);
  if (!parsed) {
    return null;
  }

  try {
    const authError = requireAgentBearerAuth(request, token);
    if (authError) {
      return authError;
    }
    initializeSchema(getDb());

    switch (parsed.kind) {
      case "list":
        return handleList();
      case "status":
        return jsonResponse(detectEnvironmentStatus({}));
      case "show":
        return handleShow(parsed.name);
      case "create":
        return handleCreate(request, deps);
      case "update":
        return handleUpdate(request, parsed.name, deps);
      case "delete":
        return handleDelete(request, url, parsed.name, deps);
      case "use":
        return handleUse(request, parsed.name, deps);
      default: {
        const _exhaustive: never = parsed;
        return _exhaustive;
      }
    }
  } catch (error) {
    return mapEnvironmentError(error);
  }
}

type EnvironmentRoute =
  | { kind: "list" }
  | { kind: "status" }
  | { kind: "show"; name: string }
  | { kind: "create" }
  | { kind: "update"; name: string }
  | { kind: "delete"; name: string }
  | { kind: "use"; name: string };

function parseEnvironmentRoute(method: string, pathname: string): EnvironmentRoute | null {
  if (pathname === "/v1/environments" || pathname === "/v1/environments/") {
    if (method === "GET") return { kind: "list" };
    if (method === "POST") return { kind: "create" };
    return null;
  }
  if (pathname === "/v1/environments/list" && method === "GET") {
    return { kind: "list" };
  }
  if (pathname === "/v1/environments/status" && method === "GET") {
    return { kind: "status" };
  }
  const useMatch = pathname.match(/^\/v1\/environments\/([^/]+)\/use$/);
  if (useMatch?.[1] && method === "POST") {
    return { kind: "use", name: decodeURIComponent(useMatch[1]) };
  }
  const named = pathname.match(/^\/v1\/environments\/([^/]+)$/);
  if (!named?.[1]) {
    return null;
  }
  const name = decodeURIComponent(named[1]);
  if (method === "GET") return { kind: "show", name };
  if (method === "PUT") return { kind: "update", name };
  if (method === "DELETE") return { kind: "delete", name };
  return null;
}

function handleList(): Response {
  const active = getGlobalActiveEnvironmentName();
  return jsonResponse({
    environments: listEnvironmentsCommand().map((row) => ({
      id: row.environment.id,
      name: row.environment.name,
      description: row.environment.description || null,
      value_count: row.value_count,
      secret_ref_count: row.secret_ref_count,
      reference_count: row.reference_count,
      is_global_active: active === row.environment.name,
    })),
  });
}

function handleShow(name: string): Response {
  return jsonResponse(showEnvironmentCommand(name));
}

function mapEnvironmentError(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Environment not found:")) {
    return jsonResponse({ error: "not_found", message }, { status: 404 });
  }
  if (
    message.includes("UNIQUE constraint failed")
    || message.includes("already exists")
  ) {
    return jsonResponse({ error: "environment_exists", message }, { status: 409 });
  }
  return jsonResponse({ error: "internal_error", message }, { status: 500 });
}

function switchInProgressResponse(): Response {
  return jsonResponse(
    {
      error: "switch_in_progress",
      message: "Another profile switch is already running",
    },
    { status: 409 },
  );
}

async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  const raw = await request.text();
  if (!raw.trim()) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse(
        { error: "invalid_body", message: "Request body must be an object" },
        { status: 400 },
      );
    }
    return parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(
      { error: "invalid_json", message: "Request body must be JSON" },
      { status: 400 },
    );
  }
}

async function handleCreate(
  request: Request,
  deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response> {
  if (deps.isAgentSwitchInProgress()) {
    return switchInProgressResponse();
  }
  const body = await readJsonObject(request);
  if (body instanceof Response) {
    return body;
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return jsonResponse(
      { error: "invalid_name", message: "name is required" },
      { status: 400 },
    );
  }
  const mode = body.mode;
  if (mode !== "blank" && mode !== "from-project" && mode !== "from-plugin") {
    return jsonResponse(
      { error: "invalid_body", message: "mode must be blank, from-project, or from-plugin" },
      { status: 400 },
    );
  }
  if (getEnvironmentByName(name)) {
    return jsonResponse(
      { error: "environment_exists", message: `Environment already exists: ${name}` },
      { status: 409 },
    );
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : undefined;

  const projectPath =
    typeof body.projectPath === "string" ? body.projectPath.trim() : "";
  const plugins = Array.isArray(body.plugins)
    ? body.plugins.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];

  if (mode === "from-project") {
    if (!projectPath.startsWith("/")) {
      return jsonResponse(
        {
          error: "projectPath_required",
          message: "from-project requires an absolute projectPath",
        },
        { status: 400 },
      );
    }
  }
  if (mode === "from-plugin") {
    if (plugins.length === 0) {
      return jsonResponse(
        { error: "invalid_body", message: "from-plugin requires a non-empty plugins array" },
        { status: 400 },
      );
    }
  }

  const created = await runEnvironmentCreate({
    name,
    ...(description ? { description } : {}),
    ...(mode === "blank" ? { blank: true } : {}),
    ...(mode === "from-project" ? { fromProject: projectPath } : {}),
    ...(mode === "from-plugin" ? { fromPlugin: plugins } : {}),
  });

  if (body.useAfterCreate === true) {
    useEnvironmentCommand(name);
  }

  return jsonResponse(normalizeCreateResult(created));
}

function normalizeCreateResult(
  created: Awaited<ReturnType<typeof runEnvironmentCreate>>,
): {
  mode: string;
  environment: EnvironmentShowPayload;
  missing_keys: unknown[];
  persisted?: boolean;
} {
  switch (created.mode) {
    case "blank":
      return { mode: "blank", environment: created.payload, missing_keys: [] };
    case "from-project": {
      const environmentId = created.result.environment_id;
      const environment = environmentId
        ? showEnvironmentCommand(environmentId)
        : showEnvironmentCommand(created.result.environment_name);
      return {
        mode: "from-project",
        environment,
        missing_keys: created.result.missing_keys,
        persisted: created.result.persisted,
      };
    }
    case "from-plugin":
      return {
        mode: "from-plugin",
        environment: created.payload,
        missing_keys: created.preview.missing_keys,
        persisted: created.persisted,
      };
    default: {
      const _exhaustive: never = created;
      return _exhaustive;
    }
  }
}

function updateEnvironmentDescription(id: string, description: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE environments SET description = ?, updated_at = ? WHERE id = ?",
    )
    .run(description, now, id);
}

const SECRET_PROVIDERS = new Set<EnvironmentSecretProvider>(["keychain", "env", "file"]);
const PERMISSION_ACTIONS = new Set<PermissionMetadata["action"]>(["allow", "deny", "ask"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function permissionIdentity(permission: {
  name?: string;
  action: string;
  pattern: string;
}): string {
  return permission.name || `${permission.action}:${permission.pattern}`;
}

async function handleUpdate(
  request: Request,
  name: string,
  deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response> {
  if (deps.isAgentSwitchInProgress()) {
    return switchInProgressResponse();
  }
  const body = await readJsonObject(request);
  if (body instanceof Response) {
    return body;
  }

  const current = showEnvironmentCommand(name);

  const envVars = body.env_vars === undefined
    ? {}
    : isPlainObject(body.env_vars)
      ? Object.fromEntries(
          Object.entries(body.env_vars).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : null;
  if (envVars === null) {
    return jsonResponse(
      { error: "invalid_body", message: "env_vars must be an object" },
      { status: 400 },
    );
  }

  const secretRefs = body.secret_refs === undefined
    ? {}
    : isPlainObject(body.secret_refs)
      ? body.secret_refs
      : null;
  if (secretRefs === null) {
    return jsonResponse(
      { error: "invalid_body", message: "secret_refs must be an object" },
      { status: 400 },
    );
  }

  const parsedSecrets: Record<string, { provider: EnvironmentSecretProvider; ref: string }> = {};
  for (const [key, value] of Object.entries(secretRefs)) {
    if (!isPlainObject(value) || typeof value.ref !== "string") {
      return jsonResponse(
        { error: "invalid_body", message: "secret_refs entries need provider and ref" },
        { status: 400 },
      );
    }
    if (
      typeof value.provider !== "string"
      || !SECRET_PROVIDERS.has(value.provider as EnvironmentSecretProvider)
    ) {
      return jsonResponse(
        { error: "invalid_body", message: "secret provider must be keychain, env, or file" },
        { status: 400 },
      );
    }
    parsedSecrets[key] = {
      provider: value.provider as EnvironmentSecretProvider,
      ref: value.ref,
    };
  }

  const modelConfigs = body.model_configs === undefined
    ? []
    : Array.isArray(body.model_configs)
      ? body.model_configs
      : null;
  if (modelConfigs === null) {
    return jsonResponse(
      { error: "invalid_body", message: "model_configs must be an array" },
      { status: 400 },
    );
  }

  const parsedModels: Array<{ name: string; model: string; provider?: string }> = [];
  for (const entry of modelConfigs) {
    if (!isPlainObject(entry) || typeof entry.model !== "string") {
      return jsonResponse(
        { error: "invalid_body", message: "model_configs entries need a model" },
        { status: 400 },
      );
    }
    parsedModels.push({
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name : "default",
      model: entry.model,
      ...(typeof entry.provider === "string" ? { provider: entry.provider } : {}),
    });
  }

  const permissions = body.permissions === undefined
    ? []
    : Array.isArray(body.permissions)
      ? body.permissions
      : null;
  if (permissions === null) {
    return jsonResponse(
      { error: "invalid_body", message: "permissions must be an array" },
      { status: 400 },
    );
  }

  const parsedPermissions: Array<{
    name?: string;
    action: PermissionMetadata["action"];
    pattern: string;
  }> = [];
  for (const entry of permissions) {
    if (!isPlainObject(entry) || typeof entry.pattern !== "string") {
      return jsonResponse(
        { error: "invalid_body", message: "permissions entries need action and pattern" },
        { status: 400 },
      );
    }
    if (
      typeof entry.action !== "string"
      || !PERMISSION_ACTIONS.has(entry.action as PermissionMetadata["action"])
    ) {
      return jsonResponse(
        { error: "invalid_body", message: "permission action must be allow, deny, or ask" },
        { status: 400 },
      );
    }
    parsedPermissions.push({
      ...(typeof entry.name === "string" && entry.name.trim() ? { name: entry.name } : {}),
      action: entry.action as PermissionMetadata["action"],
      pattern: entry.pattern,
    });
  }

  if (typeof body.description === "string") {
    updateEnvironmentDescription(current.environment.id, body.description);
  }

  for (const key of Object.keys(current.values.env_vars)) {
    if (!(key in envVars)) {
      unsetEnvironmentVarCommand(current.environment.id, key);
    }
  }
  for (const [key, value] of Object.entries(envVars)) {
    setEnvironmentVarCommand(current.environment.id, key, value);
  }

  for (const key of Object.keys(current.secret_refs)) {
    if (!(key in parsedSecrets)) {
      unsetEnvironmentSecretCommand(current.environment.id, key);
    }
  }
  for (const [key, secret] of Object.entries(parsedSecrets)) {
    setEnvironmentSecretCommand(current.environment.id, {
      key,
      provider: secret.provider,
      ref: secret.ref,
    });
  }

  const nextModelNames = new Set(parsedModels.map((row) => row.name));
  for (const existing of current.values.model_configs) {
    if (!nextModelNames.has(existing.name)) {
      unsetEnvironmentModelConfigCommand(current.environment.id, existing.name);
    }
  }
  for (const model of parsedModels) {
    setEnvironmentModelConfigCommand(current.environment.id, model);
  }

  const nextPermissionIds = new Set(parsedPermissions.map(permissionIdentity));
  for (const existing of current.values.permissions) {
    if (!nextPermissionIds.has(permissionIdentity(existing))) {
      unsetEnvironmentPermissionCommand(
        current.environment.id,
        existing.name
          ? { name: existing.name }
          : {
              action: existing.action as PermissionMetadata["action"],
              pattern: existing.pattern,
            },
      );
    }
  }
  for (const permission of parsedPermissions) {
    setEnvironmentPermissionCommand(current.environment.id, permission);
  }

  return jsonResponse(showEnvironmentCommand(name));
}

async function handleDelete(
  request: Request,
  url: URL,
  name: string,
  deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response> {
  if (deps.isAgentSwitchInProgress()) {
    return switchInProgressResponse();
  }
  const shown = showEnvironmentCommand(name);
  const forceQuery = url.searchParams.get("force") === "true";
  const body = await readJsonObject(request);
  const forceBody =
    !(body instanceof Response) && body.force === true;
  const force = forceQuery || forceBody;
  if (!force && hasEnvironmentReferences(shown.environment.id)) {
    return jsonResponse(
      {
        error: "environment_referenced",
        message: `Environment "${shown.environment.name}" is still referenced by configured plugins`,
        references: listEnvironmentReferences(shown.environment.id),
      },
      { status: 409 },
    );
  }
  if (force) {
    for (const plugin of listEnvironmentReferences(shown.environment.id).plugins) {
      setPluginDefaultEnvironment(plugin.id, null);
    }
  }
  const result = deleteEnvironmentCommand(name, { force: true });
  return jsonResponse({
    deleted: result.deleted,
    references: result.references,
  });
}

async function handleUse(
  request: Request,
  name: string,
  deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response> {
  if (deps.isAgentSwitchInProgress()) {
    return switchInProgressResponse();
  }
  const body = await readJsonObject(request);
  if (body instanceof Response) {
    return body;
  }
  if (body.local === true) {
    return jsonResponse(
      {
        error: "invalid_body",
        message: "Session-local environment use is CLI-only",
      },
      { status: 400 },
    );
  }
  return jsonResponse(useEnvironmentCommand(name));
}
