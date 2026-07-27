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
  LibraryLayer,
  LibraryResource,
  ProfileApplyPreview,
  ProfileApplyPreviewRequest,
  ProfileCreatePreview,
  ProfileCreateRequest,
  ProfileCreateResult,
  ProfileSummary,
  ProfileSwitchStepEvent,
  ProfileTagResult,
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
  throw new AgentApiError(
    body.message ?? fallback,
    response.status,
    body.error,
  );
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
  return body.profiles.map((profile) => ({
    ...profile,
    scopes: profile.scopes?.length ? profile.scopes : (["home"] as const),
  }));
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
