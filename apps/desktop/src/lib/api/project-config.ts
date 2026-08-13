import { agentFetch, throwAgentError } from "./http";

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
