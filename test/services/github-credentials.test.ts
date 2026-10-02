import { describe, expect, it } from "bun:test";
import type { RunCommand } from "../../src/plugins/run-command.js";
import {
  describeGithubCredentialSource,
  gitHttpsAuthConfigArgs,
  githubHttpsExtraHeader,
  resolveGithubCredential,
} from "../../src/services/github-credentials.js";

const silentGh: RunCommand = () => ({
  stdout: "",
  stderr: "gh not found",
  exitCode: 127,
});

describe("resolveGithubCredential", () => {
  it("prefers HARNESSTAP_GITHUB_TOKEN over GH_TOKEN and GITHUB_TOKEN", async () => {
    const resolved = await resolveGithubCredential({
      env: {
        HARNESSTAP_GITHUB_TOKEN: " ht-token ",
        GH_TOKEN: "gh-env",
        GITHUB_TOKEN: "actions-token",
      },
      readStoredToken: () => "stored",
      runCommand: () => ({ stdout: "gh-cli", stderr: "", exitCode: 0 }),
    });
    expect(resolved).toEqual({ token: "ht-token", source: "harnesstap_env" });
  });

  it("uses GH_TOKEN before GITHUB_TOKEN", async () => {
    const resolved = await resolveGithubCredential({
      env: {
        GH_TOKEN: "gh-env",
        GITHUB_TOKEN: "actions-token",
      },
      runCommand: silentGh,
    });
    expect(resolved).toEqual({ token: "gh-env", source: "gh_token_env" });
  });

  it("uses GITHUB_TOKEN when no product or GH_TOKEN env is set", async () => {
    const resolved = await resolveGithubCredential({
      env: { GITHUB_TOKEN: "actions-token" },
      runCommand: silentGh,
    });
    expect(resolved).toEqual({ token: "actions-token", source: "github_token_env" });
  });

  it("uses a stored session after env keys", async () => {
    const resolved = await resolveGithubCredential({
      env: {},
      readStoredToken: async () => " stored-token ",
      runCommand: () => ({ stdout: "gh-cli", stderr: "", exitCode: 0 }),
    });
    expect(resolved).toEqual({ token: "stored-token", source: "stored" });
  });

  it("falls back to gh auth token", async () => {
    const resolved = await resolveGithubCredential({
      env: {},
      readStoredToken: () => null,
      runCommand: (command, args) => {
        expect(command).toBe("gh");
        expect(args).toEqual(["auth", "token"]);
        return { stdout: "cli-token\n", stderr: "", exitCode: 0 };
      },
    });
    expect(resolved).toEqual({ token: "cli-token", source: "gh_cli" });
  });

  it("returns none when every source is empty", async () => {
    const resolved = await resolveGithubCredential({
      env: { GH_TOKEN: "  " },
      readStoredToken: () => "",
      runCommand: silentGh,
    });
    expect(resolved).toEqual({ token: null, source: "none" });
  });
});

describe("github git helpers", () => {
  it("builds a bearer extraHeader without embedding it in a clone URL", () => {
    expect(githubHttpsExtraHeader("secret")).toBe("Authorization: Bearer secret");
    expect(gitHttpsAuthConfigArgs("secret")).toEqual([
      "-c",
      "http.extraHeader=Authorization: Bearer secret",
    ]);
  });

  it("labels sources for error copy", () => {
    expect(describeGithubCredentialSource("harnesstap_env")).toBe(
      "HARNESSTAP_GITHUB_TOKEN",
    );
    expect(describeGithubCredentialSource("none")).toBe("none");
  });
});
