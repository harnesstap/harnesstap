export const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;

export const CATALOG_LIST_TIMEOUT_MESSAGE =
  "Catalog request timed out (30s). Try again, or list local plugins without --remote.";

function collectErrorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = "cause" in current ? current.cause : undefined;
  }
  return chain;
}

function errorCodes(error: unknown): string[] {
  return collectErrorChain(error).flatMap((entry) => {
    if (typeof entry === "object" && entry && "code" in entry && entry.code != null) {
      return [String(entry.code)];
    }
    return [];
  });
}

function errorMessages(error: unknown): string[] {
  return collectErrorChain(error).flatMap((entry) => {
    if (entry instanceof Error) return [entry.message];
    if (typeof entry === "object" && entry && "message" in entry && typeof entry.message === "string") {
      return [entry.message];
    }
    return [];
  });
}

function errorNames(error: unknown): string[] {
  return collectErrorChain(error).flatMap((entry) => {
    if (typeof entry === "object" && entry && "name" in entry && entry.name != null) {
      return [String(entry.name)];
    }
    return [];
  });
}

function codesAndMessages(error: unknown): string {
  return [...errorCodes(error), ...errorMessages(error)].join(" ").toLowerCase();
}

function isAbortTimeoutError(error: unknown): boolean {
  const names = errorNames(error);
  if (names.some((name) => name === "AbortError" || name === "TimeoutError")) {
    return true;
  }
  return errorMessages(error).some((message) =>
    /the operation was aborted|this operation was aborted/i.test(message),
  );
}

const REFUSED_CODES = new Set(["econnrefused", "connectionrefused"]);

function isConnectionRefusedError(error: unknown): boolean {
  if (errorCodes(error).some((code) => REFUSED_CODES.has(code.toLowerCase()))) {
    return true;
  }
  const text = codesAndMessages(error);
  return text.includes("econnrefused") || text.includes("connection refused");
}

const UNREACHABLE_CODES = new Set([
  "enotfound",
  "eai_again",
  "ehostunreach",
  "enetunreach",
  "econnreset",
  "connectionreset",
  "hostunreachable",
  "networkunreachable",
]);

function isUnreachableError(error: unknown): boolean {
  if (isConnectionRefusedError(error)) return true;
  if (errorCodes(error).some((code) => UNREACHABLE_CODES.has(code.toLowerCase()))) {
    return true;
  }
  const text = codesAndMessages(error);
  return (
    text.includes("enotfound")
    || text.includes("ehostunreach")
    || text.includes("enetunreach")
    || text.includes("econnreset")
    || text.includes("could not resolve host")
    || text.includes("failed to connect")
    || text.includes("network is unreachable")
    || text.includes("unable to connect")
  );
}

function formatFetchFailure(
  input: string | URL,
  timeoutMs: number,
  retries: number,
  lastError: unknown,
): Error {
  const url = String(input);
  const attempts = retries + 1;
  if (isAbortTimeoutError(lastError)) {
    return new Error(
      `Request timed out after ${timeoutMs}ms (${attempts} attempts): ${url}`,
      { cause: lastError },
    );
  }
  if (isConnectionRefusedError(lastError)) {
    return new Error(`Connection refused (${attempts} attempts): ${url}`, { cause: lastError });
  }
  if (isUnreachableError(lastError)) {
    return new Error(
      `Could not reach the server (${attempts} attempts): ${url}`,
      { cause: lastError },
    );
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  return new Error(`${detail} (${attempts} attempts): ${url}`, { cause: lastError });
}

export async function fetchWithTimeout(
  input: string | URL,
  init?: RequestInit & { timeoutMs?: number; retries?: number },
): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = init?.retries ?? DEFAULT_RETRIES;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const { timeoutMs: _t, retries: _r, ...fetchInit } = init ?? {};
      return await fetch(input, { ...fetchInit, signal: controller.signal });
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }

  throw formatFetchFailure(input, timeoutMs, retries, lastError);
}

export function isRequestTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Request timed out after");
}

export function formatCatalogRequestError(error: unknown): string {
  if (isRequestTimeoutError(error)) {
    return CATALOG_LIST_TIMEOUT_MESSAGE;
  }
  return error instanceof Error ? error.message : String(error);
}
