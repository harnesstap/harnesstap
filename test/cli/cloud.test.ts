import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import * as cloudAccounts from "../../src/config/cloud-accounts";

describe("auth CLI flow", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("login -> status (json) -> orgs --switch -> logout", async () => {
    // Device flow: device code, two polls (pending), then token
    const fetchMock = mock()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ device_code: "dc-123", user_code: "UC-ABC", verification_uri: "https://verify.example", expires_in: 600, interval: 1 }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: "authorization_pending" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "AT-XYZ", refresh_token: "RT-XYZ", expires_in: 3600, token_type: "Bearer" }) });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const login = await runCli(["auth", "login", "testprofile", "--base-url", "https://api.example"]);
    expect(login.stdout).toContain("UC-ABC");

    const got = await cloudAccounts.getCloudAccount("testprofile");
    expect(got.account?.refreshToken).toBe("RT-XYZ");

    // whoami JSON
    globalThis.fetch = mock().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user_email: "user@example.com", user_name: "User" }) }) as unknown as typeof fetch;
    const who = await runCli(["auth", "status", "--account", "testprofile", "--format", "json"]);
    expect(JSON.parse(who.stdout).user_email).toBe("user@example.com");

    // orgs list JSON
    globalThis.fetch = mock().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ orgs: [{ id: "org1", slug: "org-slug", name: "Org" }] }) }) as unknown as typeof fetch;
    const orgs = await runCli(["auth", "orgs", "--account", "testprofile", "--format", "json"]);
    expect(Array.isArray(JSON.parse(orgs.stdout))).toBe(true);

    // switch org
    globalThis.fetch = mock().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ orgs: [{ id: "org1", slug: "org-slug", name: "Org" }] }) }) as unknown as typeof fetch;
    const _switched = await runCli(["auth", "orgs", "--account", "testprofile", "--switch", "org-slug"]);
    const afterSwitch = await cloudAccounts.getCloudAccount("testprofile");
    expect(afterSwitch.account?.orgSlug).toBe("org-slug");

    // logout (revoke)
    globalThis.fetch = mock().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) as unknown as typeof fetch;
    const _out = await runCli(["auth", "logout", "--account", "testprofile"]);
    const afterLogout = await cloudAccounts.getCloudAccount("testprofile");
    expect(afterLogout.account).toBeUndefined();
  });

  it("returns empty JSON payloads when no cloud account is configured", async () => {
    const whoami = await runCli(["auth", "status", "--format", "json"]);
    const orgs = await runCli(["auth", "orgs", "--format", "json"]);

    expect(JSON.parse(whoami.stdout)).toEqual({});
    expect(JSON.parse(orgs.stdout)).toEqual([]);
  });

  it("reports missing orgs when switching to an unknown organization", async () => {
    await cloudAccounts.saveCloudAccount("testprofile", {
      cloudBaseUrl: "https://api.example",
      accessToken: "AT-XYZ",
      refreshToken: "RT-XYZ",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      scopes: [],
    });

    globalThis.fetch = mock().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ orgs: [{ id: "org1", slug: "org-slug", name: "Org" }] }),
    }) as unknown as typeof fetch;

    const result = await runCli([
      "auth",
      "orgs",
      "--account",
      "testprofile",
      "--switch",
      "missing-org",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Organization not found: missing-org");
  });
});
