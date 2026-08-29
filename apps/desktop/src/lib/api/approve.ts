import { agentFetch, throwAgentError } from "./http";

export type ExecutableGrantSide = "allow" | "deny";

export interface ExecutableGrantRequest {
  projectPath: string;
  refs: string[];
}

export interface ExecutableGrantResult {
  written: "project";
  side: ExecutableGrantSide;
  refs: string[];
  project_path: string;
}

async function postGrant(
  baseUrl: string,
  token: string | null,
  path: "/v1/approve" | "/v1/deny",
  body: ExecutableGrantRequest,
  fallback: string,
): Promise<ExecutableGrantResult> {
  const response = await agentFetch(baseUrl, token, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return throwAgentError(response, fallback);
  }
  return (await response.json()) as ExecutableGrantResult;
}

export async function postApprove(
  baseUrl: string,
  token: string | null,
  body: ExecutableGrantRequest,
): Promise<ExecutableGrantResult> {
  return postGrant(baseUrl, token, "/v1/approve", body, "Could not approve package");
}

export async function postDeny(
  baseUrl: string,
  token: string | null,
  body: ExecutableGrantRequest,
): Promise<ExecutableGrantResult> {
  return postGrant(baseUrl, token, "/v1/deny", body, "Could not deny package");
}
