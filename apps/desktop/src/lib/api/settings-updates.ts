import { agentFetch, throwAgentError } from "./http";

export type UpdateMode = "off" | "notify" | "install";
export type UpdateFrequency = "hourly" | "daily" | "weekly";

export interface UpdateSettings {
  mode: UpdateMode;
  frequency: UpdateFrequency;
  prompted: boolean;
}

export async function fetchUpdateSettings(baseUrl: string, token: string | null): Promise<UpdateSettings> {
  const response = await agentFetch(baseUrl, token, "/v1/settings/updates");
  if (!response.ok) return throwAgentError(response, "Could not read plugin update settings");
  return (await response.json()) as UpdateSettings;
}

export async function saveUpdateSettings(
  baseUrl: string,
  token: string | null,
  patch: Partial<UpdateSettings>,
): Promise<UpdateSettings> {
  const response = await agentFetch(baseUrl, token, "/v1/settings/updates", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) return throwAgentError(response, "Could not save plugin update settings");
  return (await response.json()) as UpdateSettings;
}
