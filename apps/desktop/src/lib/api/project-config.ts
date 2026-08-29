import { AgentApiError, agentFetch, throwAgentError } from "./http";

export { AgentApiError };

export type ProjectConfigProfileSource = "catalog" | "local" | "inline";

export interface ProjectConfigProfile {
  name: string;
  source: ProjectConfigProfileSource;
  selector?: string;
  plugin?: string;
  environment?: string;
}

export interface ProjectConfigJson {
  root_path: string;
  config_path: string;
  default_profile?: string;
  default_environment?: string;
  profiles: ProjectConfigProfile[];
  environments: Array<{ name: string }>;
  plugins: Array<{ name: string }>;
  environment_count: number;
  plugin_count: number;
}

export interface ProjectConfigValidation {
  valid: boolean;
  errors: string[];
}

export interface ProjectConfigInspectPayload {
  config: ProjectConfigJson;
  validation: ProjectConfigValidation;
}

export interface ProjectConfigRawPayload {
  path: string;
  contents: string;
  validation: ProjectConfigValidation;
  config?: ProjectConfigJson;
}

export async function fetchProjectConfig(
  baseUrl: string,
  token: string | null,
  projectPath: string,
): Promise<ProjectConfigInspectPayload> {
  const query = `?projectPath=${encodeURIComponent(projectPath)}`;
  const response = await agentFetch(baseUrl, token, `/v1/config${query}`);
  if (!response.ok) {
    return throwAgentError(response, "Could not load project config.");
  }
  return (await response.json()) as ProjectConfigInspectPayload;
}

export async function fetchProjectConfigRaw(
  baseUrl: string,
  token: string | null,
  projectPath: string,
): Promise<ProjectConfigRawPayload> {
  const query = `?projectPath=${encodeURIComponent(projectPath)}`;
  const response = await agentFetch(baseUrl, token, `/v1/config/raw${query}`);
  if (!response.ok) {
    return throwAgentError(response, "Could not load apm.yml.");
  }
  return (await response.json()) as ProjectConfigRawPayload;
}

export async function putProjectConfigRaw(
  baseUrl: string,
  token: string | null,
  body: { projectPath: string; contents: string },
): Promise<ProjectConfigRawPayload> {
  const response = await agentFetch(baseUrl, token, "/v1/config/raw", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
      validation?: ProjectConfigValidation;
    };
    if (body.validation && body.validation.errors.length > 0) {
      throw new AgentApiError(
        body.validation.errors.join("\n"),
        response.status,
        body.error,
      );
    }
    const detail = body.message
      ?? (body.error ? `Could not save apm.yml. (${body.error})` : null)
      ?? `Could not save apm.yml. (HTTP ${response.status})`;
    throw new AgentApiError(detail, response.status, body.error);
  }
  return (await response.json()) as ProjectConfigRawPayload;
}
