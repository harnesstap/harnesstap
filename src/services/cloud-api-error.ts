/**
 * Cloud error bodies (harnesstap-cloud#143). Primary shape:
 * `{"error":{code, entry?, ref?, message, requestId, fields?, details?}}`.
 * Older variants are still read (`message`/`requestId` beside `error`,
 * `error` as a bare code). The `x-request-id` header fills in a missing id.
 */
export interface CloudErrorDetail {
  code?: string;
  message?: string;
  requestId?: string;
  entry?: string;
  ref?: string;
  fields?: Record<string, unknown>;
  details?: unknown;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function parseCloudErrorBody(body: unknown, headers?: Headers): CloudErrorDetail {
  const headerId = str(headers?.get("x-request-id") ?? undefined);
  if (!body || typeof body !== "object") return headerId ? { requestId: headerId } : {};
  const top = body as Record<string, unknown>;
  const nested = top.error && typeof top.error === "object" ? (top.error as Record<string, unknown>) : {};
  const pick = (key: string) => str(nested[key]) ?? str(top[key]);
  return {
    code: str(nested.code) ?? str(top.error) ?? str(top.code),
    message: pick("message"),
    requestId: pick("requestId") ?? pick("request_id") ?? headerId,
    entry: pick("entry"),
    ref: pick("ref"),
    ...(record(nested.fields) ? { fields: record(nested.fields) } : {}),
    ...(nested.details !== undefined ? { details: nested.details } : {}),
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

  constructor(prefix: string, status: number, body: unknown, headers?: Headers) {
    const detail = parseCloudErrorBody(body, headers);
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
