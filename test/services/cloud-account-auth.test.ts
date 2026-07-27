import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  getCloudAccount,
  saveCloudAccount,
  setDefaultCloudAccount,
} from "../../src/config/cloud-accounts.js";
import {
  ensureCloudAccountAccess,
  forceRefreshCloudAccountAccess,
} from "../../src/services/cloud-account-auth.js";

const tmpRoot = path.join(process.cwd(), "tmp-test-cloud-account-auth");

describe("cloud account auth persistence", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    process.env.HARNESSTAP_HOME = tmpRoot;
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true });
    delete process.env.HARNESSTAP_HOME;
  });

  it("refreshes an expired access token and persists the rotated refresh token", async () => {
    const now = Math.floor(Date.now() / 1000);
    await saveCloudAccount("default", {
      cloudBaseUrl: "https://cloud.example.test",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessTokenExpiresAt: now - 10,
      scopes: ["read"],
    });
    await setDefaultCloudAccount("default");

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/api/cli/token/refresh");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
          orgId: "org-1",
          orgSlug: "acme",
          scopes: ["read"],
        }),
      };
    }) as unknown as typeof fetch;

    const ensured = await ensureCloudAccountAccess();
    expect(ensured?.accessToken).toBe("new-access");

    const stored = await getCloudAccount("default");
    expect(stored.account?.accessToken).toBe("new-access");
    expect(stored.account?.refreshToken).toBe("new-refresh");
    expect(typeof stored.account?.accessTokenExpiresAt).toBe("number");
    expect(Number(stored.account?.accessTokenExpiresAt)).toBeGreaterThan(now);
  });

  it("clears local tokens when refresh is rejected", async () => {
    const now = Math.floor(Date.now() / 1000);
    await saveCloudAccount("default", {
      cloudBaseUrl: "https://cloud.example.test",
      accessToken: "old-access",
      refreshToken: "dead-refresh",
      accessTokenExpiresAt: now - 10,
      scopes: ["read"],
    });
    await setDefaultCloudAccount("default");

    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: "invalid_grant" } }),
    })) as unknown as typeof fetch;

    const ensured = await ensureCloudAccountAccess();
    expect(ensured).toBeNull();

    const stored = await getCloudAccount("default");
    expect(stored.account?.accessToken).toBeUndefined();
    expect(stored.account?.refreshToken).toBeUndefined();
  });

  it("force-refreshes even when the access token is still within TTL", async () => {
    const now = Math.floor(Date.now() / 1000);
    await saveCloudAccount("default", {
      cloudBaseUrl: "https://cloud.example.test",
      accessToken: "still-valid",
      refreshToken: "refresh-1",
      accessTokenExpiresAt: now + 3600,
      scopes: ["read"],
    });
    await setDefaultCloudAccount("default");

    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "forced-access",
        refresh_token: "forced-refresh",
        expires_in: 3600,
      }),
    })) as unknown as typeof fetch;

    const refreshed = await forceRefreshCloudAccountAccess();
    expect(refreshed?.accessToken).toBe("forced-access");
    const stored = await getCloudAccount("default");
    expect(stored.account?.refreshToken).toBe("forced-refresh");
  });
});
