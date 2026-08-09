import { invoke } from "@tauri-apps/api/core";
import type {
  AgentHealth,
  AgentSwitchFinalEvent,
  AgentSwitchStreamEvent,
  CloudAuthLoginPollResult,
  CloudAuthStatus,
  CloudProfile,
  CloudProfilePullRequest,
  CloudProfilePullResult,
  GlobalProfileStatus,
  GlobalProfileStatusDepth,
  HarnessSettingsPayload,
  PutHarnessSettingsInput,
  PutHarnessSettingsResult,
  LibraryLayer,
  LibraryResource,
  LibraryResourceDetail,
  ProfileApplyPreview,
  ProfileApplyPreviewRequest,
  ProfileAddAllResourcesRequest,
  ProfileAddAllResourcesResult,
  ProfileAddResourceRequest,
  ProfileAddResourceResult,
  OpenPathRequest,
  OpenPathResult,
  ProfileRemoveResourceRequest,
  ProfileRemoveResourceResult,
  ProfileRestoreFileRequest,
  ProfileRestoreFileResult,
  ProfileFileDiffRequest,
  ProfileFileDiffResult,
  ProfileCreatePreview,
  ProfileCreateRequest,
  ProfileCreateResult,
  ProfileDetail,
  ProfileSummary,
  ProfileSwitchStepEvent,
  ProfileTagResult,
  ProfileRenameResult,
  ProfileStashListResult,
  ProfileStashPopResult,
  ProfileStashPushResult,
  ResourceTrackedDirectoriesResult,
  ResourceTrackedDirectoriesRescanResult,
  ResourceTrackedDirectoryAddResult,
  SwitchScope,
} from "./types";

export class AgentApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AgentApiError";
    this.status = status;
    this.code = code;
  }
}

async function readToken(): Promise<string | null> {
  try {
    return await invoke<string | null>("read_agent_token");
  } catch {
    return import.meta.env.VITE_AGENT_TOKEN ?? null;
  }
}

function resolveBaseUrl(port?: number): string {
  if (import.meta.env.VITE_AGENT_URL) {
    return import.meta.env.VITE_AGENT_URL;
  }
  const resolvedPort = port ?? Number(import.meta.env.VITE_AGENT_PORT ?? 7474);
  return `http://127.0.0.1:${resolvedPort}`;
}

export async function waitForHealth(
  preferredPort?: number,
  maxAttempts = 40,
  delayMs = 250,
): Promise<AgentHealth> {
  let lastError = "Sidecar not reachable";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const portFromNative = await invoke<number | null>("get_sidecar_port");
      const candidates = [
        preferredPort,
        portFromNative ?? undefined,
        Number(import.meta.env.VITE_AGENT_PORT ?? 7474),
        7474,
        7475,
        7476,
      ].filter((port, index, all): port is number => {
        return typeof port === "number" && Number.isFinite(port) && all.indexOf(port) === index;
      });

      for (const port of candidates) {
        const baseUrl = resolveBaseUrl(port);
        const response = await fetch(`${baseUrl}/v1/health`);
        if (response.ok) {
          return (await response.json()) as AgentHealth;
        }
        lastError = `Health check failed (${response.status}) on ${baseUrl}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(lastError);
}

export async function connectAgent(options?: {
  restart?: boolean;
}): Promise<{
  baseUrl: string;
  token: string | null;
  health: AgentHealth;
}> {
  let preferredPort: number | undefined;
  try {
    preferredPort = options?.restart
      ? await invoke<number>("restart_sidecar")
      : await invoke<number>("start_sidecar");
  } catch (error) {
    if (!import.meta.env.VITE_AGENT_URL) {
      throw error;
    }
  }

  const health = await waitForHealth(preferredPort);
  const token = await readToken();
  return {
    baseUrl: resolveBaseUrl(health.port),
    token,
    health,
  };
}

async function agentFetch(
  baseUrl: string,
  token: string | null,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

async function throwAgentError(
  response: Response,
  fallback: string,
): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
  };
  const detail = body.message
    ?? (body.error ? `${fallback} (${body.error})` : null)
    ?? `${fallback} (HTTP ${response.status})`;
  throw new AgentApiError(detail, response.status, body.error);
}

export async function fetchProfiles(
  baseUrl: string,
  projectPath?: string,
): Promise<ProfileSummary[]> {
  const params = new URLSearchParams();
  if (projectPath) {
    params.set("projectPath", projectPath);
  }
  const query = params.toString();
  const response = await fetch(
    `${baseUrl}/v1/profiles${query ? `?${query}` : ""}`,
  );
  if (!response.ok) {
    throw new AgentApiError("Could not list profiles", response.status);
  }
  const body = (await response.json()) as { profiles: ProfileSummary[] };
  return body.profiles
    .filter((profile) => profile.name !== "empty")
    .map((profile) => ({
      ...profile,
      scopes: profile.scopes?.length ? profile.scopes : (["home"] as const),
    }));
}

export async function fetchProfileStash(
  baseUrl: string,
  token: string | null,
): Promise<ProfileStashListResult> {
  const response = await agentFetch(baseUrl, token, "/v1/profiles/stash");
  if (!response.ok) {
    throw new AgentApiError("Could not list stashed profiles", response.status);
  }
  return (await response.json()) as ProfileStashListResult;
}

export async function stashActiveProfile(
  baseUrl: string,
  token: string | null,
): Promise<ProfileStashPushResult> {
  const response = await agentFetch(baseUrl, token, "/v1/profiles/stash", {
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
      body.message ?? "Could not stash active profile",
      response.status,
    );
  }
  return (await response.json()) as ProfileStashPushResult;
}

export async function popProfileStash(
  baseUrl: string,
  token: string | null,
): Promise<ProfileStashPopResult> {
  const response = await agentFetch(baseUrl, token, "/v1/profiles/stash/pop", {
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
      body.message ?? "Could not restore stashed profile",
      response.status,
    );
  }
  return (await response.json()) as ProfileStashPopResult;
}

export async function fetchLibraryLayers(
  baseUrl: string,
  token: string | null,
): Promise<LibraryLayer[]> {
  const response = await agentFetch(baseUrl, token, "/v1/library/layers");
  if (!response.ok) {
    return throwAgentError(response, "Could not load library layers");
  }
  const body = (await response.json()) as { layers: LibraryLayer[] };
  return body.layers;
}

export async function fetchLibraryResources(
  baseUrl: string,
  token: string | null,
): Promise<LibraryResource[]> {
  const response = await agentFetch(baseUrl, token, "/v1/library/resources");
  if (!response.ok) {
    return throwAgentError(response, "Could not load library resources");
  }
  const body = (await response.json()) as { resources: LibraryResource[] };
  return body.resources;
}

export async function fetchResourceTrackedDirectories(
  baseUrl: string,
  token: string | null,
): Promise<ResourceTrackedDirectoriesResult> {
  const response = await agentFetch(baseUrl, token, "/v1/library/resource-directories");
  if (!response.ok) {
    return throwAgentError(response, "Could not load tracked directories");
  }
  return (await response.json()) as ResourceTrackedDirectoriesResult;
}

export async function addResourceTrackedDirectory(
  baseUrl: string,
  token: string | null,
  path: string,
): Promise<ResourceTrackedDirectoryAddResult> {
  const response = await agentFetch(baseUrl, token, "/v1/library/resource-directories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not add tracked directory");
  }
  return (await response.json()) as ResourceTrackedDirectoryAddResult;
}

export async function removeResourceTrackedDirectory(
  baseUrl: string,
  token: string | null,
  path: string,
): Promise<void> {
  const response = await agentFetch(baseUrl, token, "/v1/library/resource-directories", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not remove tracked directory");
  }
}

export async function rescanResourceTrackedDirectories(
  baseUrl: string,
  token: string | null,
): Promise<ResourceTrackedDirectoriesRescanResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    "/v1/library/resource-directories/rescan",
    { method: "POST" },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not rescan tracked directories");
  }
  return (await response.json()) as ResourceTrackedDirectoriesRescanResult;
}

export async function fetchLibraryResourceDetail(
  baseUrl: string,
  token: string | null,
  selector: string,
  options?: { pathHint?: string | null },
): Promise<LibraryResourceDetail> {
  const pathHint = options?.pathHint?.trim();
  const query = pathHint ? `?path=${encodeURIComponent(pathHint)}` : "";
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/library/resources/${encodeURIComponent(selector)}${query}`,
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not load resource details");
  }
  const body = (await response.json()) as { resource: LibraryResourceDetail };
  return body.resource;
}

export async function previewProfileCreate(
  baseUrl: string,
  token: string | null,
  body: ProfileCreateRequest,
): Promise<ProfileCreatePreview> {
  const response = await agentFetch(baseUrl, token, "/v1/profiles/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not preview profile");
  }
  return (await response.json()) as ProfileCreatePreview;
}

export async function createProfile(
  baseUrl: string,
  token: string | null,
  body: ProfileCreateRequest,
): Promise<ProfileCreateResult> {
  const response = await agentFetch(baseUrl, token, "/v1/profiles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not create profile");
  }
  return (await response.json()) as ProfileCreateResult;
}

export async function searchCloudProfiles(
  baseUrl: string,
  token: string | null,
  query: string,
): Promise<CloudProfile[]> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("q", query.trim());
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/cloud${suffix}`,
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not browse cloud profiles");
  }
  const body = (await response.json()) as { profiles: CloudProfile[] };
  return body.profiles;
}

export async function pullCloudProfile(
  baseUrl: string,
  token: string | null,
  body: CloudProfilePullRequest,
): Promise<CloudProfilePullResult> {
  const response = await agentFetch(baseUrl, token, "/v1/profiles/cloud/pull", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not pull cloud profile");
  }
  return (await response.json()) as CloudProfilePullResult;
}

export async function fetchCloudAuthStatus(
  baseUrl: string,
  token: string | null,
): Promise<CloudAuthStatus> {
  const response = await agentFetch(baseUrl, token, "/v1/cloud/auth");
  if (!response.ok) {
    return throwAgentError(response, "Could not load cloud account");
  }
  return (await response.json()) as CloudAuthStatus;
}

export async function fetchHarnessSettings(
  baseUrl: string,
  token: string | null,
  projectPath?: string | null,
): Promise<HarnessSettingsPayload> {
  const query =
    projectPath && projectPath.trim()
      ? `?project=${encodeURIComponent(projectPath.trim())}`
      : "";
  const response = await agentFetch(baseUrl, token, `/v1/harness${query}`);
  if (!response.ok) {
    return throwAgentError(response, "Could not load harness settings");
  }
  return (await response.json()) as HarnessSettingsPayload;
}

export async function saveHarnessSettings(
  baseUrl: string,
  token: string | null,
  body: PutHarnessSettingsInput,
): Promise<PutHarnessSettingsResult> {
  const response = await agentFetch(baseUrl, token, "/v1/harness", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not save harness settings");
  }
  return (await response.json()) as PutHarnessSettingsResult;
}

export async function startCloudLogin(
  baseUrl: string,
  token: string | null,
): Promise<CloudAuthStatus> {
  const response = await agentFetch(baseUrl, token, "/v1/cloud/auth/login", {
    method: "POST",
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not start cloud login");
  }
  return (await response.json()) as CloudAuthStatus;
}

export async function pollCloudLogin(
  baseUrl: string,
  token: string | null,
): Promise<CloudAuthLoginPollResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    "/v1/cloud/auth/login/poll",
    { method: "POST" },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
      status?: string;
      intervalMs?: number;
    };
    if (body.status === "error" || body.status === "pending") {
      return body as CloudAuthLoginPollResult;
    }
    throw new AgentApiError(
      body.message ?? "Could not poll cloud login",
      response.status,
      body.error,
    );
  }
  return (await response.json()) as CloudAuthLoginPollResult;
}

export async function cancelCloudLogin(
  baseUrl: string,
  token: string | null,
): Promise<CloudAuthStatus> {
  const response = await agentFetch(
    baseUrl,
    token,
    "/v1/cloud/auth/login/cancel",
    { method: "POST" },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not cancel cloud login");
  }
  return (await response.json()) as CloudAuthStatus;
}

export async function logoutCloudAuth(
  baseUrl: string,
  token: string | null,
): Promise<CloudAuthStatus> {
  const response = await agentFetch(baseUrl, token, "/v1/cloud/auth/logout", {
    method: "POST",
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not sign out of cloud");
  }
  return (await response.json()) as CloudAuthStatus;
}

export async function tagProfile(
  baseUrl: string,
  token: string | null,
  name: string,
): Promise<ProfileTagResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeURIComponent(name)}/tag`,
    { method: "POST" },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not tag profile");
  }
  return (await response.json()) as ProfileTagResult;
}

export interface ProfileCutResult {
  profile: {
    name: string;
    version: string;
    dirty: boolean;
  };
}

export async function cutProfile(
  baseUrl: string,
  token: string | null,
  name: string,
  version: string,
): Promise<ProfileCutResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeURIComponent(name)}/cut`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version }),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not cut profile version");
  }
  return (await response.json()) as ProfileCutResult;
}

export async function renameProfile(
  baseUrl: string,
  token: string | null,
  currentName: string,
  nextName: string,
): Promise<ProfileRenameResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeURIComponent(currentName)}/rename`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nextName }),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not rename profile");
  }
  return (await response.json()) as ProfileRenameResult;
}

export async function fetchProfileDetail(
  baseUrl: string,
  token: string | null,
  name: string,
): Promise<ProfileDetail> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeURIComponent(name)}`,
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not load profile");
  }
  return (await response.json()) as ProfileDetail;
}

export async function patchProfileMetadata(
  baseUrl: string,
  token: string | null,
  name: string,
  body: { description?: string; tags?: string[] },
): Promise<ProfileDetail> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not update profile");
  }
  return (await response.json()) as ProfileDetail;
}

export async function attachProfileComposition(
  baseUrl: string,
  token: string | null,
  name: string,
  body: { layerId?: string; resourceId?: string },
): Promise<ProfileDetail> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeURIComponent(name)}/attachments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not attach to profile");
  }
  return (await response.json()) as ProfileDetail;
}

export async function detachProfileComposition(
  baseUrl: string,
  token: string | null,
  name: string,
  body: { resourceId?: string; dependencyName?: string },
): Promise<ProfileDetail> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeURIComponent(name)}/attachments`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not detach from profile");
  }
  return (await response.json()) as ProfileDetail;
}

export async function fetchStatus(
  baseUrl: string,
  depth: GlobalProfileStatusDepth,
  projectPath?: string,
): Promise<GlobalProfileStatus> {
  const params = new URLSearchParams({ depth });
  if (projectPath) {
    params.set("projectPath", projectPath);
  }
  const response = await fetch(`${baseUrl}/v1/status?${params.toString()}`);
  if (!response.ok) {
    throw new AgentApiError("Could not read live status", response.status);
  }
  return (await response.json()) as GlobalProfileStatus;
}

export async function fetchApplyPreview(
  baseUrl: string,
  token: string | null,
  body: ProfileApplyPreviewRequest,
): Promise<ProfileApplyPreview> {
  const response = await agentFetch(baseUrl, token, "/v1/profiles/apply-preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not preview profile apply");
  }
  return (await response.json()) as ProfileApplyPreview;
}

export async function addProfileResource(
  baseUrl: string,
  token: string | null,
  profileName: string,
  body: ProfileAddResourceRequest,
): Promise<ProfileAddResourceResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeURIComponent(profileName)}/add-resource`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not add resource to profile");
  }
  return (await response.json()) as ProfileAddResourceResult;
}

export async function addAllProfileResources(
  baseUrl: string,
  token: string | null,
  profileName: string,
  body: ProfileAddAllResourcesRequest,
): Promise<ProfileAddAllResourcesResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeURIComponent(profileName)}/add-all-resources`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not add all resources to profile");
  }
  return (await response.json()) as ProfileAddAllResourcesResult;
}

export async function commitProfileResource(
  baseUrl: string,
  token: string | null,
  profileName: string,
  body: ProfileAddResourceRequest & { path?: string },
): Promise<ProfileAddResourceResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeURIComponent(profileName)}/commit-resource`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not commit resource into profile");
  }
  return (await response.json()) as ProfileAddResourceResult;
}

export async function openResourcePath(
  baseUrl: string,
  token: string | null,
  body: OpenPathRequest,
): Promise<OpenPathResult> {
  const response = await agentFetch(baseUrl, token, "/v1/open-path", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not open resource path");
  }
  return (await response.json()) as OpenPathResult;
}

export async function removeProfileResource(
  baseUrl: string,
  token: string | null,
  profileName: string,
  body: ProfileRemoveResourceRequest,
): Promise<ProfileRemoveResourceResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeURIComponent(profileName)}/remove-resource`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not remove resource from profile");
  }
  return (await response.json()) as ProfileRemoveResourceResult;
}

export async function restoreProfileFile(
  baseUrl: string,
  token: string | null,
  profileName: string,
  body: ProfileRestoreFileRequest,
): Promise<ProfileRestoreFileResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeURIComponent(profileName)}/restore-file`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not restore profile file");
  }
  return (await response.json()) as ProfileRestoreFileResult;
}

export async function fetchProfileFileDiff(
  baseUrl: string,
  token: string | null,
  profileName: string,
  body: ProfileFileDiffRequest,
): Promise<ProfileFileDiffResult> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/profiles/${encodeURIComponent(profileName)}/file-diff`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    return throwAgentError(response, "Could not load file diff");
  }
  return (await response.json()) as ProfileFileDiffResult;
}

export async function bootstrapProject(
  baseUrl: string,
  token: string | null,
  input: {
    projectPath: string;
    profiles?: string[];
    defaultProfile?: string;
  },
): Promise<void> {
  const response = await agentFetch(baseUrl, token, "/v1/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    throw new AgentApiError(
      body.message ?? "Project setup failed",
      response.status,
      body.error,
    );
  }
}

export async function startSwitch(
  baseUrl: string,
  token: string | null,
  input: {
    profile: string;
    scope: SwitchScope;
    projectPath?: string;
    confirmOwnedOverwrite?: boolean;
  },
): Promise<string> {
  const response = await agentFetch(baseUrl, token, "/v1/switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 409) {
    const body = (await response.json()) as {
      error?: string;
      message?: string;
    };
    throw new AgentApiError(
      body.message ?? "Owned overwrite confirmation required",
      response.status,
      body.error,
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new AgentApiError(
      body.message ?? "Switch request failed",
      response.status,
    );
  }
  const body = (await response.json()) as { id: string };
  return body.id;
}

function isFinalEvent(event: AgentSwitchStreamEvent): event is AgentSwitchFinalEvent {
  return "type" in event && event.type === "result";
}

export function subscribeSwitchEvents(
  baseUrl: string,
  switchId: string,
  onEvent: (event: ProfileSwitchStepEvent) => void,
  onComplete: (final: AgentSwitchFinalEvent) => void,
  onError: (message: string) => void,
): () => void {
  const source = new EventSource(`${baseUrl}/v1/switch/${switchId}/events`);
  source.onmessage = (message) => {
    try {
      const parsed = JSON.parse(message.data) as AgentSwitchStreamEvent;
      if (isFinalEvent(parsed)) {
        source.close();
        onComplete(parsed);
        return;
      }
      onEvent(parsed);
    } catch {
      // ignore malformed events
    }
  };
  source.onerror = () => {
    source.close();
    onError("Lost connection to switch progress stream");
  };
  return () => source.close();
}

export async function cancelSwitch(
  baseUrl: string,
  token: string | null,
  switchId: string,
): Promise<void> {
  const response = await agentFetch(
    baseUrl,
    token,
    `/v1/switch/${switchId}/cancel`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new AgentApiError("Cancel not available", response.status);
  }
}
