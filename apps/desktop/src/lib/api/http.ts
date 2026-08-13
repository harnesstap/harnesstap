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

export async function agentFetch(
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

export async function throwAgentError(
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
