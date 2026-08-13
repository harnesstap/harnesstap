import { AgentApiError, agentFetch } from "./http";

export interface ProjectHistorySnapshot {
  id: string;
  created_at: string;
  label: string;
  file_count: number;
}

export interface ProjectHistoryResponse {
  snapshots: ProjectHistorySnapshot[];
  project_linked: boolean;
}

export interface ProjectRevertResult {
  restored_file_count: number;
  snapshot: {
    id: string;
    created_at: string;
    label: string;
  };
}

export class ProjectHistoryApiError extends AgentApiError {
  readonly hints: string[];

  constructor(message: string, status: number, code?: string, hints: string[] = []) {
    super(message, status, code);
    this.name = "ProjectHistoryApiError";
    this.hints = hints;
  }
}

function readErrorBody(body: {
  message?: string;
  error?: string;
  hints?: unknown;
}): { message: string; code?: string; hints: string[] } {
  const hints = Array.isArray(body.hints)
    ? body.hints.filter((hint): hint is string => typeof hint === "string")
    : [];
  return {
    message: body.message ?? body.error ?? "Request failed",
    code: body.error,
    hints,
  };
}

export async function fetchProjectHistory(
  baseUrl: string,
  projectPath: string,
): Promise<ProjectHistoryResponse> {
  const params = new URLSearchParams({ projectPath });
  const response = await fetch(`${baseUrl}/v1/project/history?${params.toString()}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
      hints?: unknown;
    };
    const parsed = readErrorBody(body);
    throw new ProjectHistoryApiError(
      parsed.message,
      response.status,
      parsed.code,
      parsed.hints,
    );
  }
  return (await response.json()) as ProjectHistoryResponse;
}

export async function revertProjectSnapshot(
  baseUrl: string,
  token: string | null,
  input: { snapshotId: string; projectPath: string },
): Promise<ProjectRevertResult> {
  const response = await agentFetch(baseUrl, token, "/v1/project/revert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
      hints?: unknown;
    };
    const parsed = readErrorBody(body);
    throw new ProjectHistoryApiError(
      body.message ?? `Could not revert snapshot (${parsed.code ?? response.status})`,
      response.status,
      parsed.code,
      parsed.hints,
    );
  }
  return (await response.json()) as ProjectRevertResult;
}
