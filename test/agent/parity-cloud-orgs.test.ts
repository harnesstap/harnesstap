import { describe, expect, it } from "bun:test";
import {
  createCloudOrgsTryHandle,
  tryHandle,
} from "../../src/agent/parity-handlers/cloud-orgs.ts";
import type { CloudAccount } from "../../src/config/cloud-accounts.ts";

const AGENT_TOKEN = "agent-secret";
const SWITCH_DEPS = { isAgentSwitchInProgress: () => false };

function account(overrides: Partial<CloudAccount> = {}): CloudAccount {
  return {
    cloudBaseUrl: "https://cloud.example.test",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    orgId: "org-1",
    orgSlug: "acme",
    scopes: [],
    userEmail: "user@example.com",
    userName: "Example User",
    ...overrides,
  };
}

function createService(options: {
  signedIn?: boolean;
  stored?: CloudAccount;
  orgs?: Record<string, unknown>[];
  listError?: Error;
} = {}) {
  const signedIn = options.signedIn ?? true;
  let stored = options.stored ?? account();
  const orgs = options.orgs ?? [
    { id: "org-1", slug: "acme", name: "Acme Corp" },
    { id: "org-2", slug: "beta", name: "Beta Inc" },
  ];

  return {
    stored: () => stored,
    service: {
      async ensureAccess() {
        if (!signedIn || !stored.accessToken) {
          return null;
        }
        return {
          accountName: "default",
          account: stored,
          accessToken: stored.accessToken,
        };
      },
      async listOrgs() {
        if (options.listError) {
          throw options.listError;
        }
        return orgs;
      },
      async updateAccount(
        _accountName: string,
        patch: { orgId: string; orgSlug: string },
      ) {
        stored = { ...stored, ...patch };
      },
      async whoami() {
        return {
          user: { email: stored.userEmail, name: stored.userName },
          activeOrg: { slug: stored.orgSlug },
        };
      },
    },
  };
}

function request(
  path: string,
  init: RequestInit = {},
  token = AGENT_TOKEN,
): Request {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return new Request(`http://127.0.0.1:7474${path}`, { ...init, headers });
}

describe("tryHandle", () => {
  it("returns null for unrelated paths", async () => {
    const response = await tryHandle(
      request("/v1/cloud/auth"),
      AGENT_TOKEN,
      SWITCH_DEPS,
    );
    expect(response).toBeNull();
  });
});

describe("GET /v1/cloud/auth/orgs", () => {
  it("returns 401 unauthorized without bearer", async () => {
    const { service } = createService();
    const handle = createCloudOrgsTryHandle(service);
    const response = await handle(
      new Request("http://127.0.0.1:7474/v1/cloud/auth/orgs"),
      AGENT_TOKEN,
      SWITCH_DEPS,
    );
    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({ error: "unauthorized" });
  });

  it("returns 401 not_authenticated when there is no cloud account", async () => {
    const { service } = createService({ signedIn: false });
    const handle = createCloudOrgsTryHandle(service);
    const response = await handle(
      request("/v1/cloud/auth/orgs"),
      AGENT_TOKEN,
      SWITCH_DEPS,
    );
    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({
      error: "not_authenticated",
    });
  });

  it("lists orgs and marks the stored current org first", async () => {
    const { service } = createService({
      stored: account({ orgId: "org-2", orgSlug: "beta" }),
    });
    const handle = createCloudOrgsTryHandle(service);
    const response = await handle(
      request("/v1/cloud/auth/orgs"),
      AGENT_TOKEN,
      SWITCH_DEPS,
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      orgs: Array<{ slug: string; current: boolean }>;
      current_org_slug?: string;
    };
    expect(body.current_org_slug).toBe("beta");
    expect(body.orgs.map((org) => org.slug)).toEqual(["beta", "acme"]);
    expect(body.orgs[0]?.current).toBe(true);
    expect(body.orgs[1]?.current).toBe(false);
  });

  it("returns 200 with an empty orgs array when Cloud has no memberships", async () => {
    const { service } = createService({ orgs: [] });
    const handle = createCloudOrgsTryHandle(service);
    const response = await handle(
      request("/v1/cloud/auth/orgs"),
      AGENT_TOKEN,
      SWITCH_DEPS,
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({
      orgs: [],
      current_org_slug: "acme",
    });
  });

  it("returns 502 cloud_orgs_failed when listOrgs throws", async () => {
    const { service } = createService({
      listError: new Error("upstream down"),
    });
    const handle = createCloudOrgsTryHandle(service);
    const response = await handle(
      request("/v1/cloud/auth/orgs"),
      AGENT_TOKEN,
      SWITCH_DEPS,
    );
    expect(response?.status).toBe(502);
    expect(await response?.json()).toMatchObject({
      error: "cloud_orgs_failed",
    });
  });
});

describe("POST /v1/cloud/auth/orgs/switch", () => {
  it("returns 401 not_authenticated when signed out", async () => {
    const { service } = createService({ signedIn: false });
    const handle = createCloudOrgsTryHandle(service);
    const response = await handle(
      request("/v1/cloud/auth/orgs/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "beta" }),
      }),
      AGENT_TOKEN,
      SWITCH_DEPS,
    );
    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({
      error: "not_authenticated",
    });
  });

  it("returns 400 invalid_json when the body is not JSON", async () => {
    const { service } = createService();
    const handle = createCloudOrgsTryHandle(service);
    const response = await handle(
      request("/v1/cloud/auth/orgs/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      AGENT_TOKEN,
      SWITCH_DEPS,
    );
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ error: "invalid_json" });
  });

  it("returns 400 invalid_body when slug is missing or blank", async () => {
    const { service } = createService();
    const handle = createCloudOrgsTryHandle(service);
    const response = await handle(
      request("/v1/cloud/auth/orgs/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "  " }),
      }),
      AGENT_TOKEN,
      SWITCH_DEPS,
    );
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ error: "invalid_body" });
  });

  it("patches orgId/orgSlug and returns CloudAuthStatus", async () => {
    const { service, stored } = createService();
    const handle = createCloudOrgsTryHandle(service);
    const response = await handle(
      request("/v1/cloud/auth/orgs/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "beta" }),
      }),
      AGENT_TOKEN,
      SWITCH_DEPS,
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as { orgSlug?: string; authenticated: boolean };
    expect(body.authenticated).toBe(true);
    expect(body.orgSlug).toBe("beta");
    expect(stored().orgId).toBe("org-2");
    expect(stored().orgSlug).toBe("beta");
  });

  it("matches org id as well as slug", async () => {
    const { service, stored } = createService();
    const handle = createCloudOrgsTryHandle(service);
    const response = await handle(
      request("/v1/cloud/auth/orgs/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "org-2" }),
      }),
      AGENT_TOKEN,
      SWITCH_DEPS,
    );
    expect(response?.status).toBe(200);
    expect(stored().orgSlug).toBe("beta");
    expect(((await response?.json()) as { orgSlug?: string }).orgSlug).toBe("beta");
  });

  it("returns 200 when switching to the already-current slug", async () => {
    const { service, stored } = createService();
    const handle = createCloudOrgsTryHandle(service);
    const response = await handle(
      request("/v1/cloud/auth/orgs/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "acme" }),
      }),
      AGENT_TOKEN,
      SWITCH_DEPS,
    );
    expect(response?.status).toBe(200);
    expect(stored().orgSlug).toBe("acme");
  });

  it("returns 404 org_not_found when no membership matches", async () => {
    const { service } = createService();
    const handle = createCloudOrgsTryHandle(service);
    const response = await handle(
      request("/v1/cloud/auth/orgs/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "missing" }),
      }),
      AGENT_TOKEN,
      SWITCH_DEPS,
    );
    expect(response?.status).toBe(404);
    expect(await response?.json()).toEqual({
      error: "org_not_found",
      message: "Organization not found: missing",
    });
  });

  it("returns 502 cloud_orgs_failed when list fails before match", async () => {
    const { service } = createService({
      listError: new Error("upstream down"),
    });
    const handle = createCloudOrgsTryHandle(service);
    const response = await handle(
      request("/v1/cloud/auth/orgs/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "beta" }),
      }),
      AGENT_TOKEN,
      SWITCH_DEPS,
    );
    expect(response?.status).toBe(502);
    expect(await response?.json()).toMatchObject({
      error: "cloud_orgs_failed",
    });
  });
});
