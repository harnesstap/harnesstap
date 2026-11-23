import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createServer } from "node:net";
import {
  CATALOG_LIST_TIMEOUT_MESSAGE,
  DEFAULT_TIMEOUT_MS,
  fetchWithTimeout,
  formatCatalogRequestError,
  isRequestTimeoutError,
} from "../../src/utils/fetch-with-timeout.js";

async function closedLocalPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected a TCP port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

describe("fetchWithTimeout", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("times out when fetch never resolves", async () => {
    globalThis.fetch = mock((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
    ) as unknown as typeof fetch;

    const started = Date.now();
    await expect(
      fetchWithTimeout("https://example.com/hang", { timeoutMs: 80, retries: 0 }),
    ).rejects.toThrow("Request timed out after 80ms (1 attempts)");
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("retries after a failed attempt then succeeds", async () => {
    const fetchMock = mock()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await fetchWithTimeout("https://example.com/retry", {
      timeoutMs: 1_000,
      retries: 2,
    });

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("exports the default timeout constant for callers and tests", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
  });

  it("reports a refused port as connection refused, not a timeout", async () => {
    const port = await closedLocalPort();
    const url = `http://127.0.0.1:${port}/api`;
    const started = Date.now();
    await expect(fetchWithTimeout(url, { timeoutMs: 5_000, retries: 0 })).rejects.toThrow(
      `Connection refused (1 attempts): ${url}`,
    );
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("does not report a generic fetch failure as a timeout", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("socket hung up"));
    try {
      await expect(
        fetchWithTimeout("https://example.com/fail", { timeoutMs: 1_000, retries: 0 }),
      ).rejects.toThrow("socket hung up (1 attempts): https://example.com/fail");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps catalog timeout copy only for real timeouts", async () => {
    const timeout = new Error("Request timed out after 30000ms (3 attempts): https://example.com");
    expect(isRequestTimeoutError(timeout)).toBe(true);
    expect(formatCatalogRequestError(timeout)).toBe(CATALOG_LIST_TIMEOUT_MESSAGE);

    const refused = new Error("Connection refused (3 attempts): http://127.0.0.1:9/api");
    expect(isRequestTimeoutError(refused)).toBe(false);
    expect(formatCatalogRequestError(refused)).toBe(refused.message);
  });
});
