import { AgentApiError, agentFetch } from "./http";
import type { ProfileStashEntry } from "../types";

export interface ProfileStashApplyResult {
  entry: ProfileStashEntry;
  restored: {
    profile_name: string;
    dry_run: boolean;
    cancelled: boolean;
    restored_files?: string[];
  };
  removed: false;
}

export function stashApplySuccessMessage(resourceCount: number): string {
  return `Applied ${resourceCount} untracked resource${resourceCount === 1 ? "" : "s"} (stash kept)`;
}

export function stashRestoreDropSuccessMessage(resourceCount: number): string {
  return `Restored ${resourceCount} untracked resource${resourceCount === 1 ? "" : "s"}`;
}

export async function applyProfileStash(
  baseUrl: string,
  token: string | null,
): Promise<ProfileStashApplyResult> {
  const response = await agentFetch(baseUrl, token, "/v1/profiles/stash/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (response.status === 409) {
    const body = (await response.json()) as { message?: string; error?: string };
    throw new AgentApiError(
      body.message ?? "Another profile operation is in progress",
      response.status,
      body.error,
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new AgentApiError(
      body.message ?? "Could not apply stashed profile",
      response.status,
    );
  }
  return (await response.json()) as ProfileStashApplyResult;
}
