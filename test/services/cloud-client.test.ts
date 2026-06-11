import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

describe("cloud client primitives", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("polls device auth until a token is issued", async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          device_code: "dc-123",
          user_code: "UC-ABC",
          verification_uri: "https://example.com/verify",
          expires_in: 600,
          interval: 1,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: "authorization_pending" } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: "authorization_pending" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "AT-XYZ",
          refresh_token: "RT-XYZ",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const mod = await import("../../src/services/cloud-client");
    const baseUrl = "https://api.example";
    const device = await mod.requestDeviceCode(baseUrl);
    expect(device.device_code).toBe("dc-123");

    const token = await mod.pollDeviceToken(baseUrl, device.device_code, { interval: 0.01, maxPolls: 10 });
    expect(token.access_token).toBe("AT-XYZ");
  });

  it("refreshes an expired profile before listing orgs", async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "NEW-AT",
          refresh_token: "NEW-RT",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ orgs: [{ id: "org-1", slug: "acme", name: "Acme" }] }),
      });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { createCloudClient } = await import("../../src/services/cloud-client");
    const client = createCloudClient({
      baseUrl: "https://api.example",
      token: {
        access_token: "OLD-AT",
        refresh_token: "OLD-RT",
        expires_at: Math.floor(Date.now() / 1000) - 100,
      },
    });

    const orgs = await client.listOrgs();
    expect(orgs).toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstCallUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(firstCallUrl.endsWith("/api/cli/token/refresh")).toBeTruthy();
    const secondCallUrl = String((fetchMock.mock.calls[1] as unknown[])[0]);
    expect(secondCallUrl.endsWith("/api/me/orgs")).toBeTruthy();
  });

  it("skips refresh when token has no expires_at", async () => {
    const fetchMock = mock().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: "user-1" } }),
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { createCloudClient } = await import("../../src/services/cloud-client");
    const client = createCloudClient({
      baseUrl: "https://api.example",
      token: { access_token: "AT-NOEXP" },
    });

    const result = await client.whoami();
    expect((result as { user?: { id?: string } }).user?.id).toBe("user-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCallUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(firstCallUrl.endsWith("/api/me")).toBeTruthy();
  });
});
