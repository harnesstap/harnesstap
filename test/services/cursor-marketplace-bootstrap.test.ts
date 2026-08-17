import { describe, expect, it } from "bun:test";
import type { PluginMarketplaceEntry } from "../../src/config/settings.ts";
import {
  cursorMarketplaceGitUrlKey,
  cursorMarketplaceIsRegistered,
  ensureCursorMarketplaces,
  isCursorBuiltinMarketplace,
  selectCursorMarketplacesToEnsure,
} from "../../src/services/cursor-marketplace-bootstrap.ts";
import type { CommandResult } from "../../src/plugins/run-command.ts";

function listedJson(entries: Array<{ name: string; gitUrl?: string }>): string {
  return JSON.stringify(entries);
}

describe("cursorMarketplaceGitUrlKey", () => {
  it("normalizes git suffix, trailing slash, and github ssh urls", () => {
    expect(cursorMarketplaceGitUrlKey("https://github.com/acme/plugins.git")).toBe(
      "https://github.com/acme/plugins",
    );
    expect(cursorMarketplaceGitUrlKey("https://github.com/acme/plugins/")).toBe(
      "https://github.com/acme/plugins",
    );
    expect(cursorMarketplaceGitUrlKey("git@github.com:acme/plugins.git")).toBe(
      "https://github.com/acme/plugins",
    );
  });
});

describe("cursorMarketplaceIsRegistered", () => {
  it("matches by marketplace name", () => {
    expect(
      cursorMarketplaceIsRegistered(
        [{ name: "karpathy-skills", gitUrl: "https://github.com/forrestchang/andrej-karpathy-skills" }],
        { name: "karpathy-skills", url: "https://example.com/other" },
      ),
    ).toBe(true);
  });

  it("matches by normalized git URL when names differ", () => {
    expect(
      cursorMarketplaceIsRegistered(
        [{ name: "skills", gitUrl: "https://github.com/acme/plugins.git" }],
        { name: "acme-plugins", url: "https://github.com/acme/plugins" },
      ),
    ).toBe(true);
  });

  it("does not match empty git URLs by URL", () => {
    expect(
      cursorMarketplaceIsRegistered(
        [{ name: "cursor-public", gitUrl: "" }],
        { name: "other", url: "https://github.com/acme/plugins" },
      ),
    ).toBe(false);
  });
});

describe("isCursorBuiltinMarketplace", () => {
  it("treats cursor-public as built-in", () => {
    expect(isCursorBuiltinMarketplace("cursor-public")).toBe(true);
    expect(isCursorBuiltinMarketplace("karpathy-skills")).toBe(false);
  });
});

describe("selectCursorMarketplacesToEnsure", () => {
  const registry: PluginMarketplaceEntry[] = [
    {
      name: "karpathy-skills",
      url: "https://github.com/forrestchang/andrej-karpathy-skills",
      platforms: ["cursor", "claude-code"],
    },
    {
      name: "claude-only",
      url: "https://github.com/acme/claude-plugins",
      platforms: ["claude-code"],
    },
    {
      name: "unused-cursor",
      url: "https://github.com/acme/unused",
      platforms: ["cursor"],
    },
  ];

  it("keeps cursor-platform marketplaces referenced by pin refs", () => {
    expect(
      selectCursorMarketplacesToEnsure(registry, [
        "andrej-karpathy-skills@karpathy-skills",
      ]),
    ).toEqual([
      {
        name: "karpathy-skills",
        url: "https://github.com/forrestchang/andrej-karpathy-skills",
      },
    ]);
  });
});

describe("ensureCursorMarketplaces", () => {
  it("adds unlisted marketplaces via agent plugin marketplace add", () => {
    const calls: string[][] = [];
    const result = ensureCursorMarketplaces(
      [{ name: "karpathy-skills", url: "https://github.com/forrestchang/andrej-karpathy-skills" }],
      {
        projectRoot: "/tmp/project",
        runAgentPlugin: (args): CommandResult => {
          calls.push(args);
          if (args[0] === "marketplace" && args[1] === "list") {
            return {
              exitCode: 0,
              stdout: listedJson([{ name: "cursor-public", gitUrl: "" }]),
              stderr: "",
            };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
    );

    expect(result.added).toEqual(["karpathy-skills"]);
    expect(calls).toEqual([
      ["marketplace", "list", "--format", "json"],
      [
        "marketplace",
        "add",
        "https://github.com/forrestchang/andrej-karpathy-skills",
      ],
    ]);
  });

  it("skips marketplaces already listed by name or URL", () => {
    const calls: string[][] = [];
    const result = ensureCursorMarketplaces(
      [
        { name: "karpathy-skills", url: "https://github.com/forrestchang/andrej-karpathy-skills" },
        { name: "teads-plugins", url: "https://github.com/outbrain/claude-plugins" },
      ],
      {
        projectRoot: "/tmp/project",
        runAgentPlugin: (args): CommandResult => {
          calls.push(args);
          return {
            exitCode: 0,
            stdout: listedJson([
              {
                name: "karpathy-skills",
                gitUrl: "https://github.com/forrestchang/andrej-karpathy-skills",
              },
              {
                name: "other",
                gitUrl: "https://github.com/outbrain/claude-plugins.git",
              },
            ]),
            stderr: "",
          };
        },
      },
    );

    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual(["karpathy-skills", "teads-plugins"]);
    expect(calls).toEqual([["marketplace", "list", "--format", "json"]]);
  });

  it("never adds the built-in cursor-public marketplace", () => {
    const calls: string[][] = [];
    const result = ensureCursorMarketplaces(
      [{ name: "cursor-public", url: "https://cursor.com/marketplace" }],
      {
        projectRoot: "/tmp/project",
        runAgentPlugin: (args): CommandResult => {
          calls.push(args);
          return {
            exitCode: 0,
            stdout: listedJson([]),
            stderr: "",
          };
        },
      },
    );

    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual(["cursor-public"]);
    expect(calls).toEqual([]);
  });

  it("does not invoke agent when there is nothing to ensure", () => {
    const calls: string[][] = [];
    const result = ensureCursorMarketplaces([], {
      projectRoot: "/tmp/project",
      runAgentPlugin: (args): CommandResult => {
        calls.push(args);
        return { exitCode: 0, stdout: "[]", stderr: "" };
      },
    });
    expect(result.added).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("skips adds when marketplace list fails", () => {
    const calls: string[][] = [];
    const result = ensureCursorMarketplaces(
      [{ name: "karpathy-skills", url: "https://github.com/forrestchang/andrej-karpathy-skills" }],
      {
        projectRoot: "/tmp/project",
        runAgentPlugin: (args): CommandResult => {
          calls.push(args);
          return {
            exitCode: 1,
            stdout: "",
            stderr: "not logged in",
          };
        },
      },
    );

    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual(["karpathy-skills"]);
    expect(result.listFailed).toMatch(/not logged in/);
    expect(calls).toEqual([["marketplace", "list", "--format", "json"]]);
  });

  it("skips adds when marketplace list is not JSON", () => {
    const result = ensureCursorMarketplaces(
      [{ name: "karpathy-skills", url: "https://github.com/forrestchang/andrej-karpathy-skills" }],
      {
        projectRoot: "/tmp/project",
        runAgentPlugin: (): CommandResult => ({
          exitCode: 0,
          stdout: "cursor-public            global",
          stderr: "",
        }),
      },
    );

    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual(["karpathy-skills"]);
    expect(result.listFailed).toBeDefined();
  });
});
