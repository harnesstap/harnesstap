import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  DEFAULT_TIMEOUT_MS,
  fetchWithTimeout,
} from "../../src/services/transport/fetch-with-timeout.js";

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
});
