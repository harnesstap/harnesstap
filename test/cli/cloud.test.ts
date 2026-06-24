import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../helpers/cli.ts";
import * as cloudAccounts from "../../src/config/cloud-accounts";
import { saveCatalogSettings } from "../../src/config/catalog";

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
      .mockResolvedValueOnce(jsonResponse(200, {
        device_code: "dc-123",
        user_code: "UC-ABC",
        verification_uri: "https://verify.example",
        expires_in: 600,
        interval: 1,
      }))
      .mockResolvedValueOnce(jsonResponse(400, { error: { code: "authorization_pending" } }, { ok: false }))
      .mockResolvedValueOnce(jsonResponse(200, {
        access_token: "AT-XYZ",
        refresh_token: "RT-XYZ",
        expires_in: 3600,
        token_type: "Bearer",
      }));

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

  it("uses the configured catalog cloud base URL when --base-url is omitted", async () => {
    const harnessdeckDir = mkdtempSync(join(tmpdir(), "hd-auth-login-"));
    saveCatalogSettings({ cloudBaseUrl: "https://cloud.example.test" }, harnessdeckDir);
    process.env.HARNESSDECK_HOME = harnessdeckDir;

    const fetchMock = mock()
      .mockResolvedValueOnce(jsonResponse(200, {
        device_code: "dc-123",
        user_code: "UC-ABC",
        verification_uri: "https://0.0.0.0:3000/cli/auth/device",
        expires_in: 600,
        interval: 1,
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        access_token: "AT-XYZ",
        refresh_token: "RT-XYZ",
        expires_in: 3600,
        token_type: "Bearer",
      }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const login = await runCli(["auth", "login", "catalogprofile"]);
    expect(login.stdout).toContain("Visit: https://cloud.example.test/cli/auth/device");
    expect(login.stdout).not.toContain("0.0.0.0:3000");

    const firstCallUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(firstCallUrl).toStartWith("https://cloud.example.test/api/cli/device/code");

    const got = await cloudAccounts.getCloudAccount("catalogprofile");
    expect(got.account?.cloudBaseUrl).toBe("https://cloud.example.test");

    delete process.env.HARNESSDECK_HOME;
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
