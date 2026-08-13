import { agentFetch, throwAgentError } from "./http";

export interface ProfileDeleteResult {
  plugin_id: string;
  plugin_name: string;
  tags: string[];
  was_active: boolean;
  plugin_deleted: boolean;
}

export interface ProfileDeleteRequestBody {
  deletePlugin: boolean;
}

export function profileDeleteRequestBody(
  deletePlugin: boolean,
): ProfileDeleteRequestBody {
  return { deletePlugin };
}

export function profileDeleteSuccessMessage(result: ProfileDeleteResult): string {
  if (result.plugin_deleted) {
    return `Removed profile ${result.plugin_name} and deleted the plugin`;
  }
  return `Removed profile ${result.plugin_name}`;
}

export function shouldShowProfileDeleteControls(input: {
  disabled: boolean;
  baseUrl: string | null;
  token: string | null;
}): boolean {
  return Boolean(input.baseUrl && input.token && !input.disabled);
}

export function isBuiltinEmptyProfileName(name: string): boolean {
  return name.trim() === "empty";
}

export async function deleteProfile(
  baseUrl: string,
  token: string | null,
  name: string,
  deletePlugin = false,
): Promise<ProfileDeleteResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeURIComponent(name)}`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profileDeleteRequestBody(deletePlugin)),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not remove profile");
  }
  return (await response.json()) as ProfileDeleteResult;
}
