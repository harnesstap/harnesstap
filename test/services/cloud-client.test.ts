import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for cloud client primitives

describe("cloud client primitives", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("polls device auth until a token is issued", async () => {
    // Prepare fetch mock sequence: device code -> pending -> pending -> token
    const fetchMock = vi.fn()
      // requestDeviceCode
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ device_code: "dc-123", user_code: "UC-ABC", verification_uri: "https://example.com/verify", expires_in: 600, interval: 1 }) })
      // poll 1: authorization_pending
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "authorization_pending" }) })
      // poll 2: authorization_pending
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "authorization_pending" }) })
      // poll 3: success
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "AT-XYZ", refresh_token: "RT-XYZ", expires_in: 3600, token_type: "Bearer" }) });

    vi.stubGlobal("fetch", fetchMock);

    const mod = await import("../../src/services/cloud-client");

    const baseUrl = "https://api.example";
    const device = await mod.requestDeviceCode(baseUrl);
    expect(device.device_code).toBe("dc-123");

    const token = await mod.pollDeviceToken(baseUrl, device.device_code, { interval: 0.01, maxPolls: 10 });
    expect(token.access_token).toBe("AT-XYZ");
  });

  it("refreshes an expired profile before searching libraries", async () => {
    const fetchMock = vi.fn()
      // refresh token call
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "NEW-AT", refresh_token: "NEW-RT", expires_in: 3600, token_type: "Bearer" }) })
      // search libraries call
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ results: [{ id: "lib1", name: "Library One" }] }) });

    vi.stubGlobal("fetch", fetchMock);

    const { createCloudClient } = await import("../../src/services/cloud-client");

    const client = createCloudClient({ baseUrl: "https://api.example", token: { access_token: "OLD-AT", refresh_token: "OLD-RT", expires_at: Math.floor(Date.now() / 1000) - 100 } });

    const res = await client.searchLibraries("query-term");
    expect(res.results).toBeDefined();

    // First call should be token refresh, second call should be the search
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstCallUrl = (fetchMock.mock.calls[0] as any[])[0];
    expect((firstCallUrl as string).endsWith("/oauth/token")).toBeTruthy();
  });
});
