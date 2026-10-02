import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  DEFAULT_GITHUB_APP_CLIENT_ID,
  GITHUB_APP_CLIENT_SECRET_ENV,
} from "../../src/config/github-app.ts";
import {
  pollGithubDeviceToken,
  pollGithubDeviceTokenOnce,
  requestGithubDeviceCode,
} from "../../src/services/github-device-flow.ts";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GitHub device flow", () => {
  const originalFetch = globalThis.fetch;
  const env: NodeJS.ProcessEnv = {};

  beforeEach(() => {
    delete env[GITHUB_APP_CLIENT_SECRET_ENV];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requests a device code with the public client id and no secret", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://github.com/login/device/code");
      expect(String(init?.body)).toContain(`client_id=${DEFAULT_GITHUB_APP_CLIENT_ID}`);
      expect(String(init?.body)).not.toContain("client_secret");
      return jsonResponse(200, {
        device_code: "device-secret",
        user_code: "ABCD-EFGH",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const device = await requestGithubDeviceCode({ env, fetch: fetchMock as unknown as typeof fetch });
    expect(device.user_code).toBe("ABCD-EFGH");
    expect(device.verification_uri_complete).toContain("ABCD-EFGH");
    expect(device.device_code).toBe("device-secret");
  });

  it("treats authorization_pending as pending and does not leak device_code in the result", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(400, {
        error: "authorization_pending",
        error_description: "authorization pending",
      }),
    );
    const result = await pollGithubDeviceTokenOnce("device-secret", {
      env,
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(result).toEqual({ status: "pending", intervalMs: 5000 });
    expect(JSON.stringify(result)).not.toContain("device-secret");
  });

  it("returns an access token after a pending poll without embedding a client secret", async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce(
        jsonResponse(400, { error: "authorization_pending" }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "ghu_live",
          token_type: "bearer",
          expires_in: 28800,
          refresh_token: "ghr_live",
        }),
      );

    const token = await pollGithubDeviceToken("device-secret", {
      env,
      fetch: fetchMock as unknown as typeof fetch,
      interval: 0,
      sleep: async () => undefined,
    });
    expect(token.access_token).toBe("ghu_live");
    expect(token.refresh_token).toBe("ghr_live");
    const secondBody = String(fetchMock.mock.calls[1]?.[1]?.body);
    expect(secondBody).toContain("client_id=");
    expect(secondBody).not.toContain("client_secret");
  });

  it("includes client_secret only when the env var is set", async () => {
    env[GITHUB_APP_CLIENT_SECRET_ENV] = "super-secret-value";
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(init?.body)).toContain("client_secret=super-secret-value");
      return jsonResponse(200, { access_token: "ghu_live" });
    });
    const result = await pollGithubDeviceTokenOnce("device-secret", {
      env,
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(result.status).toBe("authorized");
  });
});
