import { invoke } from "@tauri-apps/api/core";
import type {
  AgentHealth,
  AgentSwitchFinalEvent,
  AgentSwitchStreamEvent,
  GlobalProfileStatus,
  GlobalProfileStatusDepth,
  PersonaSummary,
  ProfileSwitchStepEvent,
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
  maxAttempts = 40,
  delayMs = 250,
): Promise<AgentHealth> {
  let lastError = "Sidecar not reachable";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const port = await invoke<number | null>("get_sidecar_port");
      const baseUrl = resolveBaseUrl(port ?? undefined);
      const response = await fetch(`${baseUrl}/v1/health`);
      if (response.ok) {
        return (await response.json()) as AgentHealth;
      }
      lastError = `Health check failed (${response.status})`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(lastError);
}

export async function connectAgent(): Promise<{
  baseUrl: string;
  token: string | null;
  health: AgentHealth;
}> {
  try {
    await invoke("start_sidecar");
  } catch (error) {
    if (!import.meta.env.VITE_AGENT_URL) {
      throw error;
    }
  }

  const health = await waitForHealth();
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
  if (token && init.method && init.method !== "GET") {
    headers.set("authorization", `Bearer ${token}`);
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

export async function fetchPersonas(
  baseUrl: string,
): Promise<PersonaSummary[]> {
  const response = await fetch(`${baseUrl}/v1/personas`);
  if (!response.ok) {
    throw new AgentApiError("Could not list personas", response.status);
  }
  const body = (await response.json()) as { personas: PersonaSummary[] };
  return body.personas;
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

export async function bootstrapProject(
  baseUrl: string,
  token: string | null,
  projectPath: string,
): Promise<void> {
  const response = await agentFetch(baseUrl, token, "/v1/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectPath }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new AgentApiError(
      body.message ?? "Project setup failed",
      response.status,
    );
  }
}

export async function startSwitch(
  baseUrl: string,
  token: string | null,
  input: {
    persona: string;
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
