import { describe, expect, it, mock } from "bun:test";
import {
  type GithubAuthDeps,
  createGithubAuthHandlers,
} from "../../src/agent/github-auth-handlers.ts";
import {
  createAgentFetchHandler,
  createDefaultAgentRouteDeps,
} from "../../src/agent/routes.ts";
import type { GithubSession } from "../../src/config/github-session.ts";

function createDeps(overrides: Partial<GithubAuthDeps> = {}): GithubAuthDeps {
  let pending: ReturnType<GithubAuthDeps["getPending"]> = null;
  let session: GithubSession | null = null;
  const now = 1_700_000_000_000;

  return {
    getSession: () => session,
    saveSession: (next) => {
      session = next;
    },
    clearSession: () => {
      session = null;
    },
    ensureAccess: async () => session,
    requestDeviceCode: async () => ({
      device_code: "device-secret",
      user_code: "ABCD-EFGH",
      verification_uri: "https://github.com/login/device",
      verification_uri_complete:
        "https://github.com/login/device?user_code=ABCD-EFGH",
      expires_in: 900,
      interval: 5,
    }),
    pollDeviceTokenOnce: async () => ({
      status: "pending",
      intervalMs: 5000,
    }),
    fetchUser: async () => ({ login: "octocat", id: 1, name: "The Octocat" }),
    now: () => now,
    getPending: () => pending,
    setPending: (next) => {
      pending = next;
    },
    ...overrides,
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

function createFetch(deps: GithubAuthDeps) {
  return createAgentFetchHandler("agent-secret", 7474, {
    ...createDefaultAgentRouteDeps(),
    githubAuthHandlers: createGithubAuthHandlers(deps),
  });
}

describe("agent GitHub auth routes", () => {
  it("requires agent bearer auth", async () => {
    const getSession = mock(() => null);
    const fetch = createFetch(createDeps({ getSession }));
    const response = await fetch(
      new Request("http://127.0.0.1:7474/v1/github/auth"),
    );
    expect(response.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("starts a device login and keeps device_code private", async () => {
    const fetch = createFetch(createDeps());
    const response = await fetch(postRequest("/v1/github/auth/login"));
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.authenticated).toBe(false);
    expect(body.pendingLogin).toEqual({
      user_code: "ABCD-EFGH",
      verification_uri: "https://github.com/login/device",
      verification_uri_complete:
        "https://github.com/login/device?user_code=ABCD-EFGH",
      expires_at: 1_700_000_000_000 + 900_000,
    });
    expect(JSON.stringify(body)).not.toContain("device-secret");
  });

  it("polls pending login until authorized and saves the session", async () => {
    let calls = 0;
    let session: GithubSession | null = null;
    let pending: ReturnType<GithubAuthDeps["getPending"]> = null;
    const fetch = createFetch(createDeps({
      getSession: () => session,
      saveSession: (next) => {
        session = next;
      },
      ensureAccess: async () => session,
      getPending: () => pending,
      setPending: (next) => {
        pending = next;
      },
      pollDeviceTokenOnce: async () => {
        calls += 1;
        if (calls === 1) {
          return { status: "pending", intervalMs: 5000 };
        }
        return {
          status: "authorized",
          token: {
            access_token: "ghu_live",
            refresh_token: "ghr_live",
            expires_in: 28800,
          },
        };
      },
    }));

    await fetch(postRequest("/v1/github/auth/login"));
    const pendingPoll = await fetch(postRequest("/v1/github/auth/login/poll"));
    expect(await pendingPoll.json()).toEqual({
      status: "pending",
      intervalMs: 5000,
    });

    const done = await fetch(postRequest("/v1/github/auth/login/poll"));
    const body = await done.json() as {
      status: string;
      auth: { authenticated: boolean; login?: string };
    };
    expect(body.status).toBe("complete");
    expect(body.auth.authenticated).toBe(true);
    expect(body.auth.login).toBe("octocat");
    expect(JSON.stringify(body)).not.toContain("device-secret");
    expect(JSON.stringify(body)).not.toContain("ghu_live");
    expect(session?.accessToken).toBe("ghu_live");
  });
});
