import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

function jsonResponse(
  status: number,
  body: unknown,
  init: { ok?: boolean; headers?: Headers } = {},
) {
  const text = JSON.stringify(body);
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    headers: init.headers ?? new Headers(),
    json: async () => body,
    text: async () => text,
  };
}

describe("cloud client primitives", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rewrites loopback verification URIs to the configured cloud base URL", async () => {
    const { resolveDeviceVerificationUris } = await import("../../src/services/cloud-client");
    expect(
      resolveDeviceVerificationUris("https://harnesstap.com", {
        user_code: "ABCD-EFGH",
        verification_uri: "http://localhost:3000/cli/auth/device",
        verification_uri_complete:
          "http://localhost:3000/cli/auth/device?user_code=ABCD-EFGH",
      }),
    ).toEqual({
      verification_uri: "https://harnesstap.com/cli/auth/device",
      verification_uri_complete:
        "https://harnesstap.com/cli/auth/device?user_code=ABCD-EFGH",
    });
  });

  it("maps cloud 503 responses to a temporary unavailability error", async () => {
    globalThis.fetch = mock().mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => "no available server",
    }) as unknown as typeof fetch;

    const { requestDeviceCode } = await import("../../src/services/cloud-client");
    await expect(requestDeviceCode("https://cloud.harnesstap.com")).rejects.toThrow(
      /temporarily unavailable/i,
    );
  });

  it("polls device auth until a token is issued", async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce(jsonResponse(200, {
        device_code: "dc-123",
        user_code: "UC-ABC",
        verification_uri: "https://example.com/verify",
        expires_in: 600,
        interval: 1,
      }))
      .mockResolvedValueOnce(jsonResponse(400, { error: { code: "authorization_pending" } }, { ok: false }))
      .mockResolvedValueOnce(jsonResponse(400, { error: { code: "authorization_pending" } }, { ok: false }))
      .mockResolvedValueOnce(jsonResponse(200, {
        access_token: "AT-XYZ",
        refresh_token: "RT-XYZ",
        expires_in: 3600,
        token_type: "Bearer",
      }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const mod = await import("../../src/services/cloud-client");
    const baseUrl = "https://api.example";
    const device = await mod.requestDeviceCode(baseUrl);
    expect(device.device_code).toBe("dc-123");

    const token = await mod.pollDeviceToken(baseUrl, device.device_code, { interval: 0.01, maxPolls: 10 });
    expect(token.access_token).toBe("AT-XYZ");
  });

  it("retries device token polling on transient empty responses", async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: new Headers(),
        json: async () => {
          throw new Error("not json");
        },
        text: async () => "",
      })
      .mockResolvedValueOnce(jsonResponse(400, { error: { code: "authorization_pending" } }, { ok: false }))
      .mockResolvedValueOnce(jsonResponse(200, {
        access_token: "AT-XYZ",
        refresh_token: "RT-XYZ",
        expires_in: 3600,
        token_type: "Bearer",
      }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { pollDeviceToken } = await import("../../src/services/cloud-client");
    const token = await pollDeviceToken("https://api.example", "dc-123", { interval: 0.01, maxPolls: 5 });
    expect(token.access_token).toBe("AT-XYZ");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("waits and retries when device token polling is rate limited", async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce(jsonResponse(
        429,
        { error: { code: "rate_limit_exceeded", message: "Too many device token polling requests." } },
        { ok: false, headers: new Headers({ "retry-after": "1" }) },
      ))
      .mockResolvedValueOnce(jsonResponse(400, { error: { code: "authorization_pending" } }, { ok: false }))
      .mockResolvedValueOnce(jsonResponse(200, {
        access_token: "AT-XYZ",
        refresh_token: "RT-XYZ",
        expires_in: 3600,
        token_type: "Bearer",
      }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { pollDeviceToken } = await import("../../src/services/cloud-client");
    const startedAt = Date.now();
    const token = await pollDeviceToken("https://api.example", "dc-123", { interval: 0.01, maxPolls: 5 });
    expect(token.access_token).toBe("AT-XYZ");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refreshes an expired profile before listing orgs", async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce(jsonResponse(200, {
        access_token: "NEW-AT",
        refresh_token: "NEW-RT",
        expires_in: 3600,
        token_type: "Bearer",
      }))
      .mockResolvedValueOnce(jsonResponse(200, { orgs: [{ id: "org-1", slug: "acme", name: "Acme" }] }));

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
    const fetchMock = mock().mockResolvedValueOnce(jsonResponse(200, { user: { id: "user-1" } }));

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
