import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../helpers/cli.ts";
import { loadGithubSession } from "../../src/config/github-session.ts";
import { resetGithubTokenLookups } from "../../src/services/github-credentials.ts";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("github CLI flow", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalHome: string | undefined;
  const savedTokens = {
    HARNESSTAP_GITHUB_TOKEN: process.env.HARNESSTAP_GITHUB_TOKEN,
    GH_TOKEN: process.env.GH_TOKEN,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalHome = process.env.HARNESSTAP_HOME;
    process.env.HARNESSTAP_HOME = mkdtempSync(join(tmpdir(), "ht-github-cli-"));
    delete process.env.HARNESSTAP_GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    resetGithubTokenLookups();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) {
      delete process.env.HARNESSTAP_HOME;
    } else {
      process.env.HARNESSTAP_HOME = originalHome;
    }
    for (const [key, value] of Object.entries(savedTokens)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetGithubTokenLookups();
  });

  it("login stores a session then status and logout", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/login/device/code")) {
        return jsonResponse(200, {
          device_code: "dc-123",
          user_code: "UC-ABC",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      }
      if (url.includes("/login/oauth/access_token")) {
        return jsonResponse(200, {
          access_token: "ghu_xyz",
          refresh_token: "ghr_xyz",
          expires_in: 28800,
          token_type: "bearer",
        });
      }
      if (url.endsWith("/user")) {
        return jsonResponse(200, { login: "octocat", id: 1, name: "The Octocat" });
      }
      return jsonResponse(404, { message: url });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const login = await runCli(["github", "login"]);
    expect(login.stdout).toContain("UC-ABC");
    expect(login.stdout).toContain("octocat");
    expect(JSON.stringify(login)).not.toContain("dc-123");
    expect(JSON.stringify(login)).not.toContain("ghu_xyz");

    const stored = loadGithubSession();
    expect(stored?.accessToken).toBe("ghu_xyz");
    expect(stored?.login).toBe("octocat");

    const status = await runCli(["github", "status", "--format", "json"]);
    const payload = JSON.parse(status.stdout) as { authenticated: boolean; login?: string };
    expect(payload.authenticated).toBe(true);
    expect(payload.login).toBe("octocat");

    await runCli(["github", "logout"]);
    expect(loadGithubSession()).toBeNull();
  });

  it("status json when logged out", async () => {
    const result = await runCli(["github", "status", "--format", "json"]);
    const payload = JSON.parse(result.stdout) as {
      authenticated: boolean;
      source: string;
    };
    expect(payload.authenticated).toBe(false);
    expect(["none", "gh_cli"]).toContain(payload.source);
  });
});
