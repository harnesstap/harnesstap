import { agentFetch, throwAgentError, AgentApiError } from "./http";

export type ResourceOnConflict = "overwrite" | "ignore" | "fail";

export interface ResourceSyncSummary {
  id: string;
  type: string;
  name: string;
  namespace: string | null;
}

export interface ResourceSyncStaleEntry {
  resource: ResourceSyncSummary;
  reason: string;
}

export interface ResourceSyncResult {
  dry_run: boolean;
  checked: number;
  updated: ResourceSyncSummary[];
  unchanged: ResourceSyncSummary[];
  skipped: ResourceSyncSummary[];
  stale: ResourceSyncStaleEntry[];
}

export interface ResourceDeleteResult {
  deleted: true;
  resource: ResourceSyncSummary;
}

export interface SyncLibraryResourceInput {
  dry_run: boolean;
  on_conflict?: ResourceOnConflict;
}

export function isResourceConflictError(error: unknown): boolean {
  return error instanceof AgentApiError && error.code === "resource_conflict";
}

export async function syncLibraryResource(
  baseUrl: string,
  token: string | null,
  selector: string,
  input: SyncLibraryResourceInput,
): Promise<ResourceSyncResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/library/resources/${encodeURIComponent(selector)}/sync`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dry_run: input.dry_run,
        on_conflict: input.on_conflict ?? "fail",
      }),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not sync resource");
  }
  return (await response.json()) as ResourceSyncResult;
}

export async function deleteLibraryResource(
  baseUrl: string,
  token: string | null,
  selector: string,
): Promise<ResourceDeleteResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/library/resources/${encodeURIComponent(selector)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not delete resource");
  }
  return (await response.json()) as ResourceDeleteResult;
}

export async function patchLibraryResource(
  baseUrl: string,
  token: string | null,
  selector: string,
  input: { name?: string; description?: string; content?: string },
): Promise<void> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/library/resources/${encodeURIComponent(selector)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not update resource");
  }
}
