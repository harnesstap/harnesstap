import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import type { RunCommand } from "../../src/plugins/run-command.ts";
import {
  detectMarketplaceType,
  parseGithubOwnerRepo,
} from "../../src/services/marketplace-type-detect.ts";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeManifest(root: string, relative: string, body: object = { plugins: [] }): void {
  const full = join(root, relative);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, `${JSON.stringify(body)}\n`);
}

describe("parseGithubOwnerRepo", () => {
  it("parses https, git, and ssh GitHub URLs", () => {
    expect(parseGithubOwnerRepo("https://github.com/acme/plugins")).toEqual({
      owner: "acme",
      repo: "plugins",
    });
    expect(parseGithubOwnerRepo("https://github.com/acme/plugins.git")).toEqual({
      owner: "acme",
      repo: "plugins",
    });
    expect(parseGithubOwnerRepo("git@github.com:acme/plugins.git")).toEqual({
      owner: "acme",
      repo: "plugins",
    });
    expect(parseGithubOwnerRepo("ssh://git@github.com/acme/plugins.git")).toEqual({
      owner: "acme",
      repo: "plugins",
    });
  });

  it("returns null for local paths and non-GitHub remotes", () => {
    expect(parseGithubOwnerRepo("/tmp/market")).toBeNull();
    expect(parseGithubOwnerRepo("https://gitlab.com/acme/plugins")).toBeNull();
  });
});

describe("detectMarketplaceType local filesystem", () => {
  it("infers Claude Code from .claude-plugin/marketplace.json", async () => {
    const root = tempDir("ht-mkt-detect-claude-");
    writeManifest(root, ".claude-plugin/marketplace.json");
    const result = await detectMarketplaceType(root);
    expect(result).toEqual({
      status: "inferred",
      platforms: ["claude-code"],
      manifests: [".claude-plugin/marketplace.json"],
      message: "Inferred: Claude Code",
    });
  });

  it("infers Cursor from .cursor-plugin/marketplace.json", async () => {
    const root = tempDir("ht-mkt-detect-cursor-");
    writeManifest(root, ".cursor-plugin/marketplace.json");
    const result = await detectMarketplaceType(root);
    expect(result.status).toBe("inferred");
    expect(result.platforms).toEqual(["cursor"]);
    expect(result.message).toBe("Inferred: Cursor");
  });

  it("infers Copilot CLI from .github/plugin/marketplace.json", async () => {
    const root = tempDir("ht-mkt-detect-copilot-");
    writeManifest(root, ".github/plugin/marketplace.json");
    const result = await detectMarketplaceType(root);
    expect(result.platforms).toEqual(["copilot-cli"]);
    expect(result.message).toBe("Inferred: Copilot CLI");
  });

  it("infers Claude Code and Cursor when both manifests exist", async () => {
    const root = tempDir("ht-mkt-detect-both-");
    writeManifest(root, ".claude-plugin/marketplace.json");
    writeManifest(root, ".cursor-plugin/marketplace.json");
    const result = await detectMarketplaceType(root);
    expect(result.status).toBe("inferred");
    expect(result.platforms).toEqual(["claude-code", "cursor"]);
    expect(result.message).toBe("Inferred: Claude Code and Cursor");
  });

  it("is ambiguous when only marketplace.json exists at the repo root", async () => {
    const root = tempDir("ht-mkt-detect-root-");
    writeManifest(root, "marketplace.json");
    const result = await detectMarketplaceType(root);
    expect(result).toEqual({
      status: "ambiguous",
      platforms: [],
      manifests: ["marketplace.json"],
      message:
        "Could not tell marketplace type. Found marketplace.json at the repo root.",
    });
  });

  it("errors when the folder has no marketplace manifest", async () => {
    const root = tempDir("ht-mkt-detect-empty-");
    const result = await detectMarketplaceType(root);
    expect(result.status).toBe("error");
    expect(result.platforms).toEqual([]);
    expect(result.message).toBe("No marketplace manifest found.");
  });

  it("errors when the local path does not exist", async () => {
    const result = await detectMarketplaceType("/tmp/ht-missing-marketplace-path-xyz");
    expect(result.status).toBe("error");
    expect(result.message).toBe("Local path not found.");
  });
});

describe("detectMarketplaceType GitHub", () => {
  it("uses gh to read private repo contents when available", async () => {
    const runCommand: RunCommand = (command, args) => {
      if (command === "gh" && args[0] === "--version") {
        return { stdout: "gh 2.0", stderr: "", exitCode: 0 };
      }
      if (command === "gh" && args.includes("repos/acme/private-plugins/contents/.claude-plugin/marketplace.json")) {
        return { stdout: '{"type":"file"}', stderr: "", exitCode: 0 };
      }
      if (command === "gh" && args[0] === "api") {
        return { stdout: "", stderr: "gh: Not Found (HTTP 404)", exitCode: 1 };
      }
      return { stdout: "", stderr: "unexpected", exitCode: 1 };
    };

    const result = await detectMarketplaceType(
      "https://github.com/acme/private-plugins",
      { runCommand },
    );
    expect(result.status).toBe("inferred");
    expect(result.platforms).toEqual(["claude-code"]);
    expect(result.manifests).toEqual([".claude-plugin/marketplace.json"]);
  });

  it("falls back to the public GitHub API when gh is missing", async () => {
    const runCommand: RunCommand = () => ({
      stdout: "",
      stderr: "not found",
      exitCode: 1,
    });
    const fetchGithub = async (owner: string, repo: string, path: string) => {
      expect(owner).toBe("cursor");
      expect(repo).toBe("plugins");
      if (path === ".cursor-plugin/marketplace.json") {
        return { status: 200 as const };
      }
      return { status: 404 as const };
    };

    const result = await detectMarketplaceType("https://github.com/cursor/plugins.git", {
      runCommand,
      fetchGithub,
    });
    expect(result.status).toBe("inferred");
    expect(result.platforms).toEqual(["cursor"]);
  });

  it("asks for gh auth when a private GitHub repo cannot be read", async () => {
    const runCommand: RunCommand = (command, args) => {
      if (command === "gh" && args[0] === "--version") {
        return { stdout: "gh 2.0", stderr: "", exitCode: 0 };
      }
      return {
        stdout: "",
        stderr: "gh: HTTP 401: Bad credentials",
        exitCode: 1,
      };
    };
    const fetchGithub = async () => ({ status: 404 as const });

    const result = await detectMarketplaceType("https://github.com/acme/secret", {
      runCommand,
      fetchGithub,
    });
    expect(result.status).toBe("error");
    expect(result.message).toBe(
      "Could not read this GitHub repo. For private repos, run gh auth login.",
    );
  });

  it("asks to install gh when the public API cannot read the repo", async () => {
    const runCommand: RunCommand = () => ({ stdout: "", stderr: "", exitCode: 1 });
    const fetchGithub = async () => ({ status: 404 as const });

    const result = await detectMarketplaceType("https://github.com/acme/secret", {
      runCommand,
      fetchGithub,
    });
    expect(result.status).toBe("error");
    expect(result.message).toBe(
      "Could not read this GitHub repo. Install GitHub CLI (gh) and run gh auth login for private repos.",
    );
  });

  it("errors for remotes that are not local or GitHub", async () => {
    const result = await detectMarketplaceType("https://gitlab.com/acme/plugins");
    expect(result.status).toBe("error");
    expect(result.message).toBe("Detection supports a local folder or a GitHub URL.");
  });
});
