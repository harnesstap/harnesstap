import { agentFetch, throwAgentError } from "./http";

export interface EnvironmentListRow {
  id: string;
  name: string;
  description: string | null;
  value_count: number;
  secret_ref_count: number;
  reference_count: number;
  is_global_active: boolean;
}

export interface EnvironmentShowPayload {
  environment: {
    id: string;
    name: string;
    description: string;
    created_at: string;
    updated_at: string;
  };
  values: {
    env_vars: Record<string, string>;
    model_configs: Array<{ name: string; model: string; provider?: string }>;
    permissions: Array<{ name: string; action: string; pattern: string }>;
  };
  secret_refs: Record<string, { provider: string; ref: string }>;
  references: { plugins: Array<{ id: string; name: string }> };
  has_detected_drift?: boolean;
}

export interface EnvironmentStatusPayload {
  global_environment: string | null;
  local_environment?: string | null;
  effective_environment?: string | null;
  has_drift: boolean;
  drift: unknown[];
}

export type EnvironmentCreateMode = "blank" | "from-project" | "from-plugin";

export interface EnvironmentCreateRequest {
  name: string;
  description?: string;
  mode: EnvironmentCreateMode;
  projectPath?: string;
  plugins?: string[];
  useAfterCreate?: boolean;
}

export interface EnvironmentCreateResult {
  mode: EnvironmentCreateMode;
  environment: EnvironmentShowPayload;
  missing_keys: Array<{ key: string }>;
  persisted?: boolean;
}

export interface EnvironmentPutRequest {
  description?: string;
  env_vars?: Record<string, string>;
  model_configs?: Array<{ name: string; model: string; provider?: string }>;
  permissions?: Array<{ name?: string; action: "allow" | "deny" | "ask"; pattern: string }>;
  secret_refs?: Record<string, { provider: "keychain" | "env" | "file"; ref: string }>;
}

export function filterEnvironmentsByQuery(
  rows: EnvironmentListRow[],
  query: string,
): EnvironmentListRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return rows;
  }
  return rows.filter((row) => {
    const haystack = `${row.name} ${row.description ?? ""}`.toLowerCase();
    return haystack.includes(needle);
  });
}

export function environmentDeleteNeedsForce(row: EnvironmentListRow): boolean {
  return row.reference_count > 0;
}

export function environmentApplyAvailable(payload: {
  has_detected_drift?: boolean;
}): boolean {
  return payload.has_detected_drift === true;
}

export function canSubmitEnvironmentCreate(input: {
  name: string;
  mode: EnvironmentCreateMode;
  projectPath: string | null;
  plugins: string[];
}): boolean {
  if (!input.name.trim()) {
    return false;
  }
  switch (input.mode) {
    case "blank":
      return true;
    case "from-project":
      return Boolean(input.projectPath && input.projectPath.length > 0);
    case "from-plugin":
      return input.plugins.length > 0;
    default: {
      const _exhaustive: never = input.mode;
      return _exhaustive;
    }
  }
}

function encodeName(name: string): string {
  return encodeURIComponent(name);
}

export async function listEnvironments(
  baseUrl: string,
  token: string | null,
): Promise<EnvironmentListRow[]> {
  const response = await agentFetch(baseUrl, token, "/v1/environments/list");
  if (!response.ok) {
    return throwAgentError(response, "Could not list environments");
  }
  const body = (await response.json()) as { environments: EnvironmentListRow[] };
  return body.environments;
}

export async function fetchEnvironmentStatus(
  baseUrl: string,
  token: string | null,
): Promise<EnvironmentStatusPayload> {
  const response = await agentFetch(baseUrl, token, "/v1/environments/status");
  if (!response.ok) {
    return throwAgentError(response, "Could not load environment status");
  }
  return (await response.json()) as EnvironmentStatusPayload;
}

export async function fetchEnvironment(
  baseUrl: string,
  token: string | null,
  name: string,
): Promise<EnvironmentShowPayload> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/environments/${encodeName(name)}`,
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not load environment");
  }
  return (await response.json()) as EnvironmentShowPayload;
}

export async function createEnvironment(
  baseUrl: string,
  token: string | null,
  body: EnvironmentCreateRequest,
): Promise<EnvironmentCreateResult> {
  const response = await agentFetch(baseUrl, token, "/v1/environments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not create environment");
  }
  return (await response.json()) as EnvironmentCreateResult;
}

export async function putEnvironment(
  baseUrl: string,
  token: string | null,
  name: string,
  body: EnvironmentPutRequest,
): Promise<EnvironmentShowPayload> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/environments/${encodeName(name)}`,
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not save environment");
  }
  return (await response.json()) as EnvironmentShowPayload;
}

export async function deleteEnvironment(
  baseUrl: string,
  token: string | null,
  name: string,
  force: boolean,
): Promise<void> {
  const query = force ? "?force=true" : "";
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/environments/${encodeName(name)}${query}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not delete environment");
  }
}

export async function useEnvironmentGlobally(
  baseUrl: string,
  token: string | null,
  name: string,
): Promise<void> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/environments/${encodeName(name)}/use`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not use environment");
  }
}
