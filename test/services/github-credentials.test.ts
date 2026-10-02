import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { saveGithubSession } from "../../src/config/github-session.ts";
import {
  githubGitConfigArgs,
  githubGitHttpAuthorizationHeader,
  githubHttpsRemoteForAuth,
  resetGithubTokenLookups,
  resolveGithubAccessToken,
} from "../../src/services/github-credentials.ts";

const tmpRoot = path.join(process.cwd(), "tmp-test-github-credentials");

const ORIGINAL_ENV = {
  HARNESSTAP_HOME: process.env.HARNESSTAP_HOME,
  HARNESSTAP_GITHUB_TOKEN: process.env.HARNESSTAP_GITHUB_TOKEN,
  GH_TOKEN: process.env.GH_TOKEN,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

beforeEach(() => {
  resetGithubTokenLookups();
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.env.HARNESSTAP_HOME = tmpRoot;
  delete process.env.HARNESSTAP_GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  resetGithubTokenLookups();
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true });
  restoreEnv();
});

describe("resolveGithubAccessToken", () => {
  it("prefers HARNESSTAP_GITHUB_TOKEN over GH_TOKEN and GITHUB_TOKEN", () => {
    const resolved = resolveGithubAccessToken({
      env: {
        HARNESSTAP_GITHUB_TOKEN: "ht",
        GH_TOKEN: "gh",
        GITHUB_TOKEN: "actions",
      },
      lookupGhCli: false,
      session: null,
    });
    expect(resolved).toEqual({ token: "ht", source: "harnesstap_github_token" });
  });

  it("uses the stored session after env tokens", () => {
    saveGithubSession({
      clientId: "Iv23liiaeCAUoGKe2uUx",
      accessToken: "ghu_session",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    const resolved = resolveGithubAccessToken({
      env: {},
      lookupGhCli: false,
    });
    expect(resolved).toEqual({ token: "ghu_session", source: "harnesstap_session" });
  });

  it("skips an expired stored session", () => {
    saveGithubSession({
      clientId: "Iv23liiaeCAUoGKe2uUx",
      accessToken: "ghu_old",
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) - 10,
    });
    const resolved = resolveGithubAccessToken({
      env: {},
      lookupGhCli: false,
    });
    expect(resolved.source).toBe("none");
    expect(resolved.token).toBeNull();
  });

  it("falls back to gh auth token after the stored session", () => {
    const resolved = resolveGithubAccessToken({
      env: {},
      session: null,
      lookupGhCli: true,
      runCommand: () => ({ stdout: "gho_cli\n", stderr: "", exitCode: 0 }),
    });
    expect(resolved).toEqual({ token: "gho_cli", source: "gh_cli" });
  });
});

describe("github git auth helpers", () => {
  it("adds a basic x-access-token extraheader and never a token in the URL", () => {
    const args = githubGitConfigArgs("ghu_secret");
    const extra = args.find((arg) => arg.includes("AUTHORIZATION: basic "));
    expect(extra).toBe(
      `http.https://github.com/.extraheader=${githubGitHttpAuthorizationHeader("ghu_secret")}`,
    );
    expect(args).toContain("http.https://github.com/.extraheader=");
    const encoded = extra?.split("AUTHORIZATION: basic ")[1] ?? "";
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe("x-access-token:ghu_secret");
    expect(args.join(" ")).not.toContain("AUTHORIZATION: bearer");
    expect(args.join(" ")).not.toContain("ghu_secret@github.com");
    expect(githubHttpsRemoteForAuth("git@github.com:acme/private.git", "ghu_secret")).toBe(
      "https://github.com/acme/private.git",
    );
    expect(githubHttpsRemoteForAuth("git@github.com:acme/private.git", null)).toBe(
      "git@github.com:acme/private.git",
    );
  });
});
