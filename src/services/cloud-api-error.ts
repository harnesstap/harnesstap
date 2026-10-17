/**
 * Cloud 4xx bodies (harnesstap-cloud#143):
 * `{"error":{"code","entry"|"ref","message","requestId"}}`. `message` and
 * `requestId` are also read beside `error`, and `error` may be a bare code.
 */
export interface CloudErrorDetail {
  code?: string;
  message?: string;
  requestId?: string;
  entry?: string;
  ref?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseCloudErrorBody(body: unknown): CloudErrorDetail {
  if (!body || typeof body !== "object") return {};
  const top = body as Record<string, unknown>;
  const nested = top.error && typeof top.error === "object" ? (top.error as Record<string, unknown>) : {};
  const pick = (key: string) => str(nested[key]) ?? str(top[key]);
  return {
    code: str(nested.code) ?? str(top.error) ?? str(top.code),
    message: pick("message"),
    requestId: pick("requestId") ?? pick("request_id"),
    entry: pick("entry"),
    ref: pick("ref"),
  };
}

/** Parses a JSON body that may sit after a status prefix, e.g. `HTTP 400: {...}`. */
export function parseCloudErrorText(text: string): CloudErrorDetail {
  const start = text.indexOf("{");
  if (start < 0) return {};
  try {
    return parseCloudErrorBody(JSON.parse(text.slice(start)));
  } catch {
    return {};
  }
}

export class CloudApiError extends Error {
  readonly status: number;
  readonly detail: CloudErrorDetail;

  constructor(prefix: string, status: number, body: unknown) {
    const detail = parseCloudErrorBody(body);
    const text = detail.message ?? detail.code ?? JSON.stringify(body ?? {});
    super(`${prefix}: ${status} ${text}`);
    this.name = "CloudApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function cloudErrorDetail(error: unknown): CloudErrorDetail {
  if (error instanceof CloudApiError) return error.detail;
  return parseCloudErrorText(error instanceof Error ? error.message : String(error));
}

export function requestIdSuffix(detail: CloudErrorDetail): string {
  return detail.requestId ? ` (request ${detail.requestId})` : "";
}
