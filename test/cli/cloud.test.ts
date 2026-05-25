import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import * as cloudProfiles from "../../src/config/cloud-profiles";

describe("cloud CLI auth flow", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("login -> whoami (json) -> orgs --switch -> logout", async () => {
    // Device flow: device code, two polls (pending), then token
    const fetchMock = mock()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ device_code: "dc-123", user_code: "UC-ABC", verification_uri: "https://verify.example", expires_in: 600, interval: 1 }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "authorization_pending" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: "AT-XYZ", refresh_token: "RT-XYZ", expires_in: 3600, token_type: "Bearer" }) });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const login = await runCli(["cloud", "login", "testprofile", "--base-url", "https://api.example"]);
    expect(login.stdout).toContain("UC-ABC");

    const got = await cloudProfiles.getCloudProfile("testprofile");
    expect(got.profile?.refreshToken).toBe("RT-XYZ");

    // whoami JSON
    globalThis.fetch = mock().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user_email: "user@example.com", user_name: "User" }) }) as unknown as typeof fetch;
    const who = await runCli(["cloud", "whoami", "--profile", "testprofile", "--format", "json"]);
    expect(JSON.parse(who.stdout).user_email).toBe("user@example.com");

    // orgs list JSON
    globalThis.fetch = mock().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: "org1", slug: "org-slug", name: "Org" }]) }) as unknown as typeof fetch;
    const orgs = await runCli(["cloud", "orgs", "--profile", "testprofile", "--format", "json"]);
    expect(Array.isArray(JSON.parse(orgs.stdout))).toBe(true);

    // switch org
    globalThis.fetch = mock().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: "org1", slug: "org-slug", name: "Org" }]) }) as unknown as typeof fetch;
    const _switched = await runCli(["cloud", "orgs", "--profile", "testprofile", "--switch", "org-slug"]);
    const afterSwitch = await cloudProfiles.getCloudProfile("testprofile");
    expect(afterSwitch.profile?.orgSlug).toBe("org-slug");

    // logout (revoke)
    globalThis.fetch = mock().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) as unknown as typeof fetch;
    const _out = await runCli(["cloud", "logout", "--profile", "testprofile"]);
    const afterLogout = await cloudProfiles.getCloudProfile("testprofile");
    expect(afterLogout.profile).toBeUndefined();
  });
});
