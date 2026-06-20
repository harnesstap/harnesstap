export const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;

export const CATALOG_LIST_TIMEOUT_MESSAGE =
  "Catalog request timed out (30s). Try again or use --local-only to skip remote listing.";

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

  throw new Error(
    `Request timed out after ${timeoutMs}ms (${retries + 1} attempts): ${String(input)}`,
    { cause: lastError },
  );
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
