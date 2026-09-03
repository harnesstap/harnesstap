import { agentFetch, throwAgentError } from "./http";

export interface DesktopUpdateAsset {
  name: string;
  browser_download_url: string;
}

export interface DesktopUpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  notes: string;
  htmlUrl: string;
  asset: DesktopUpdateAsset | null;
}

export interface DesktopUpdateApplyResult {
  version: string;
  asset: string;
  path: string;
}

export async function fetchDesktopUpdateStatus(
  baseUrl: string,
  token: string | null,
): Promise<DesktopUpdateStatus> {
  const response = await agentFetch(baseUrl, token, "/v1/app-update");
  if (!response.ok) {
    return throwAgentError(response, "Could not check for Desktop updates");
  }
  return (await response.json()) as DesktopUpdateStatus;
}

export async function applyDesktopUpdate(
  baseUrl: string,
  token: string | null,
): Promise<DesktopUpdateApplyResult> {
  const response = await agentFetch(baseUrl, token, "/v1/app-update/apply", {
    method: "POST",
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not install the Desktop update");
  }
  return (await response.json()) as DesktopUpdateApplyResult;
}
