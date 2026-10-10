import { describe, expect, it } from "bun:test";
import {
  COMMAND_CATALOG,
  COMMAND_LOADER_IDS,
  findCatalogEntry,
  visibleCatalogEntries,
} from "../../src/cli/command-catalog.ts";

describe("command catalog", () => {
  it("covers every loader id used by visible commands", () => {
    const used = new Set(COMMAND_CATALOG.map((entry) => entry.loader));
    expect([...used].sort()).toEqual([...COMMAND_LOADER_IDS].sort());
  });

  it("lists the top-level groups and project commands", () => {
    expect(visibleCatalogEntries("group").map((entry) => entry.name)).toEqual([
      "auth",
      "config",
      "environment",
      "github",
      "harness",
      "help",
      "lock",
      "marketplace",
      "mcp",
      "migrate",
      "plugin",
      "policy",
      "profile",
      "resource",
    ]);
    expect(visibleCatalogEntries("project").map((entry) => entry.name)).toEqual([
      "add",
      "apply",
      "approve",
      "audit",
      "compile",
      "deny",
      "history",
      "init",
      "install",
      "mirror",
      "open",
      "pack",
      "revert",
      "scan",
      "status",
      "targets",
      "use",
    ]);
  });

  it("resolves aliases and hidden tokens to loaders", () => {
    expect(findCatalogEntry("l")?.loader).toBe("plugin");
    expect(findCatalogEntry("layer")?.loader).toBe("plugin");
    expect(findCatalogEntry("__complete")?.loader).toBe("help");
    expect(findCatalogEntry("p")?.name).toBe("profile");
  });
});
