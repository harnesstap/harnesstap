import { agentFetch, throwAgentError } from "./http";

export interface ProfileDefaultEnvironmentResult {
  defaultEnvironment: string | null;
}

function defaultEnvironmentPath(name: string): string {
  return `/v1/profiles/${encodeURIComponent(name)}/default-environment`;
}

export async function fetchProfileDefaultEnvironment(
  baseUrl: string,
  token: string | null,
  name: string,
): Promise<ProfileDefaultEnvironmentResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    defaultEnvironmentPath(name),
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not load default environment");
  }
  return (await response.json()) as ProfileDefaultEnvironmentResult;
}

export async function patchProfileDefaultEnvironment(
  baseUrl: string,
  token: string | null,
  name: string,
  defaultEnvironment: string | null,
): Promise<ProfileDefaultEnvironmentResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    defaultEnvironmentPath(name),
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultEnvironment }),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not update default environment");
  }
  return (await response.json()) as ProfileDefaultEnvironmentResult;
}
