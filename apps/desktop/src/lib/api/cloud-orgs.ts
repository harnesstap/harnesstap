import type { CloudAuthStatus } from "../types";
import { agentFetch, throwAgentError } from "./http";

export interface CloudOrg {
  id: string;
  slug: string;
  name: string;
  current: boolean;
}

export interface CloudOrgsListResult {
  orgs: CloudOrg[];
  current_org_slug?: string;
}

export async function fetchCloudOrgs(
  baseUrl: string,
  token: string | null,
): Promise<CloudOrgsListResult> {
  const response = await agentFetch(baseUrl, token, "/v1/cloud/auth/orgs");
  if (!response.ok) {
    return throwAgentError(response, "Could not load organizations.");
  }
  return (await response.json()) as CloudOrgsListResult;
}

export async function switchCloudOrg(
  baseUrl: string,
  token: string | null,
  slug: string,
): Promise<CloudAuthStatus> {
  const response = await agentFetch(baseUrl, token, "/v1/cloud/auth/orgs/switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug }),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not switch organization.");
  }
  return (await response.json()) as CloudAuthStatus;
}

export function filterCloudOrgs(orgs: CloudOrg[], query: string): CloudOrg[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return orgs;
  }
  return orgs.filter((org) => {
    return (
      org.name.toLowerCase().includes(needle)
      || org.slug.toLowerCase().includes(needle)
    );
  });
}
