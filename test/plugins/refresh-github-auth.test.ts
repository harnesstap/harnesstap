import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetGithubTokenLookups } from "../../src/services/github-credentials.ts";
import { refreshGitSource } from "../../src/plugins/refresh.ts";
import type { RunCommand } from "../../src/plugins/run-command.ts";

describe("refreshGitSource GitHub auth", () => {
  const previous = {
    HARNESSTAP_GITHUB_TOKEN: process.env.HARNESSTAP_GITHUB_TOKEN,
    GH_TOKEN: process.env.GH_TOKEN,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  };

  beforeEach(() => {
    process.env.HARNESSTAP_GITHUB_TOKEN = "ghu_clone";
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    resetGithubTokenLookups();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetGithubTokenLookups();
  });

  it("clones with extraheader and without embedding the token in the URL", () => {
    const seen: string[][] = [];
    const run: RunCommand = (_command, args) => {
      seen.push(args);
      if (args.includes("clone")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (args.includes("rev-parse")) {
        return { stdout: "abc123\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "unexpected", exitCode: 1 };
    };
    const result = refreshGitSource({
      url: "https://github.com/acme/private.git",
      targetDir: mkdtempSync(join(tmpdir(), "ht-refresh-auth-")),
      runCommand: run,
    });
    expect(result.ok).toBe(true);
    const clone = seen.find((args) => args.includes("clone")) ?? [];
    const extra = clone.find((arg) => arg.includes("AUTHORIZATION: basic "));
    expect(extra).toBeDefined();
    const encoded = extra?.split("AUTHORIZATION: basic ")[1] ?? "";
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe("x-access-token:ghu_clone");
    expect(clone.join(" ")).not.toContain("AUTHORIZATION: bearer");
    expect(clone).toContain("https://github.com/acme/private.git");
    expect(clone.join(" ")).not.toContain("ghu_clone@github.com");
  });
});
