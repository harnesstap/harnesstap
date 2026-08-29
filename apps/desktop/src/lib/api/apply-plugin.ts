import type { ExecutableTrustFields } from "../pending-approvals";
import { agentFetch, throwAgentError, AgentApiError } from "./http";

export type ApplyPluginScope = "home" | "project";
export type ApplyOnConflict = "replace" | "skip";

export interface ApplyPluginRequest {
  plugins: string[];
  scope: ApplyPluginScope;
  projectPath?: string;
  onConflict?: ApplyOnConflict;
  dryRun?: boolean;
  confirmOwnedOverwrite?: boolean;
  harness?: string;
}

export interface ApplyPluginPlatformFiles {
  platform: string;
  files?: Array<{ path: string }>;
  written_files?: string[];
  skipped_files?: string[];
}

export interface ApplyPluginResult extends ExecutableTrustFields {
  scope: ApplyPluginScope;
  cancelled?: boolean;
  dry_run?: boolean;
  profile_name?: string;
  harnesses?: string[];
  files?: string[];
  plugin?: string;
  plugins?: string[];
  project_root?: string;
  platforms?: ApplyPluginPlatformFiles[];
}

export { AgentApiError };

export async function postApply(
  baseUrl: string,
  token: string | null,
  body: ApplyPluginRequest,
): Promise<ApplyPluginResult> {
  const response = await agentFetch(baseUrl, token, "/v1/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not apply plugin");
  }
  return (await response.json()) as ApplyPluginResult;
}
