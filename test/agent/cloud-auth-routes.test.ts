import { describe, expect, it, mock } from "bun:test";
import {
  type CloudAuthDeps,
  createCloudAuthHandlers,
} from "../../src/agent/cloud-auth-handlers.ts";
import {
  createAgentFetchHandler,
  createDefaultAgentRouteDeps,
} from "../../src/agent/routes.ts";
import type { CloudAccount } from "../../src/config/cloud-accounts.ts";

function createDeps(overrides: Partial<CloudAuthDeps> = {}): CloudAuthDeps {
  let pending: ReturnType<CloudAuthDeps["getPending"]> = null;
  let account: CloudAccount | undefined;
  let accountName: string | null = null;
  const now = 1_700_000_000_000;

  return {
    resolveBaseUrl: () => "https://cloud.example.test",
    getAccount: async () => ({
      accountName,
      account,
    }),
    saveAccount: async (name, next) => {
      accountName = name;
      account = next;
    },
    setDefaultAccount: async (name) => {
      accountName = name;
    },
    removeAccount: async (name) => {
      if (accountName === name) {
        accountName = null;
        account = undefined;
      }
    },
    requestDeviceCode: async () => ({
      device_code: "device-secret",
      user_code: "ABCD-EFGH",
      verification_uri: "https://cloud.example.test/cli/auth/device",
      verification_uri_complete:
        "https://cloud.example.test/cli/auth/device?user_code=ABCD-EFGH",
      expires_in: 600,
      interval: 5,
    }),
    pollDeviceTokenOnce: async () => ({
      status: "pending",
      intervalMs: 5000,
    }),
    whoami: async () => ({
      user: { email: "user@example.com", name: "Example User" },
      activeOrg: { slug: "acme" },
    }),
    revokeRefreshToken: async () => undefined,
    deviceVerificationUri: (baseUrl) => `${baseUrl}/cli/auth/device`,
    now: () => now,
    getPending: () => pending,
    setPending: (next) => {
      pending = next;
    },
    ...overrides,
    ...(overrides.now
      ? {}
      : {
          now: () => now,
        }),
    ...(overrides.getPending || overrides.setPending
      ? {
          getPending: overrides.getPending ?? (() => pending),
          setPending: overrides.setPending ?? ((next) => {
            pending = next;
          }),
        }
      : {}),
  };
}

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer agent-secret");
  return new Request(`http://127.0.0.1:7474${path}`, { ...init, headers });
}

function postRequest(path: string): Request {
  return request(path, { method: "POST" });
}

function createFetch(deps: CloudAuthDeps) {
  return createAgentFetchHandler("agent-secret", 7474, {
    ...createDefaultAgentRouteDeps(),
    cloudAuthHandlers: createCloudAuthHandlers(deps),
  });
}

describe("agent cloud auth routes", () => {
  it("requires agent bearer auth", async () => {
    const getAccount = mock(async () => ({
      accountName: null,
      account: undefined,
    }));
    const fetch = createFetch(createDeps({ getAccount }));

    const response = await fetch(
      new Request("http://127.0.0.1:7474/v1/cloud/auth"),
    );

    expect(response.status).toBe(401);
    expect(getAccount).not.toHaveBeenCalled();
  });

  it("returns unauthenticated status without a cloud token", async () => {
    const fetch = createFetch(createDeps());

    const response = await fetch(request("/v1/cloud/auth"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: false,
    });
  });

  it("starts a device login and keeps device_code private", async () => {
    const fetch = createFetch(createDeps());

    const response = await fetch(postRequest("/v1/cloud/auth/login"));

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.authenticated).toBe(false);
    expect(body.pendingLogin).toEqual({
      user_code: "ABCD-EFGH",
      verification_uri: "https://cloud.example.test/cli/auth/device",
      verification_uri_complete:
        "https://cloud.example.test/cli/auth/device?user_code=ABCD-EFGH",
      expires_at: 1_700_000_000_000 + 600_000,
    });
    expect(JSON.stringify(body)).not.toContain("device-secret");
  });

  it("polls pending login until authorized and saves the account", async () => {
    const deps = createDeps({
      pollDeviceTokenOnce: mock(async () => ({
        status: "authorized" as const,
        token: {
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          orgId: "org-1",
          orgSlug: "acme",
          scopes: ["read", "publish"],
        },
      })),
    });
    const fetch = createFetch(deps);

    await fetch(postRequest("/v1/cloud/auth/login"));
    const response = await fetch(postRequest("/v1/cloud/auth/login/poll"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "complete",
      auth: {
        authenticated: true,
        accountName: "default",
        email: "user@example.com",
        name: "Example User",
        orgSlug: "acme",
        cloudBaseUrl: "https://cloud.example.test",
      },
    });

    const status = await fetch(request("/v1/cloud/auth"));
    await expect(status.json()).resolves.toEqual({
      authenticated: true,
      accountName: "default",
      email: "user@example.com",
      name: "Example User",
      orgSlug: "acme",
      cloudBaseUrl: "https://cloud.example.test",
    });
  });

  it("returns pending poll intervals while waiting for approval", async () => {
    const deps = createDeps({
      pollDeviceTokenOnce: async () => ({
        status: "pending",
        intervalMs: 8000,
      }),
    });
    const fetch = createFetch(deps);

    await fetch(postRequest("/v1/cloud/auth/login"));
    const response = await fetch(postRequest("/v1/cloud/auth/login/poll"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "pending",
      intervalMs: 8000,
    });
  });

  it("cancels a pending login", async () => {
    const fetch = createFetch(createDeps());

    await fetch(postRequest("/v1/cloud/auth/login"));
    const response = await fetch(postRequest("/v1/cloud/auth/login/cancel"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: false,
    });

    const poll = await fetch(postRequest("/v1/cloud/auth/login/poll"));
    expect(poll.status).toBe(409);
  });

  it("logs out and clears the saved account", async () => {
    const revokeRefreshToken = mock(async () => undefined);
    const deps = createDeps({
      revokeRefreshToken,
      getAccount: async () => ({
        accountName: "default",
        account: {
          cloudBaseUrl: "https://cloud.example.test",
          accessToken: "access-1",
          refreshToken: "refresh-1",
          orgSlug: "acme",
          scopes: ["read"],
        },
      }),
      removeAccount: mock(async () => undefined),
    });
    const fetch = createFetch(deps);

    const response = await fetch(postRequest("/v1/cloud/auth/logout"));

    expect(response.status).toBe(200);
    expect(revokeRefreshToken).toHaveBeenCalled();
    expect(deps.removeAccount).toHaveBeenCalledWith("default");
  });
});
