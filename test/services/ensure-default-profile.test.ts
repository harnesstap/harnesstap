import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { listProfilePlugins } from "../../src/constants/profile.ts";
import { getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { getPluginResources } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { getActiveProfileName } from "../../src/services/active-profile.ts";
import {
  ensureDefaultProfilePlugin,
  seedDefaultProfileFromLibrary,
} from "../../src/services/ensure-default-profile.ts";
import { createProfileCommand } from "../../src/services/profile-commands.ts";

describe("ensureDefaultProfilePlugin", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (previousHome === undefined) {
      delete process.env.HARNESSTAP_HOME;
    } else {
      process.env.HARNESSTAP_HOME = previousHome;
    }
  });

  function withHome() {
    const dir = mkdtempSync(join(tmpdir(), "ht-ensure-default-"));
    tempDirs.push(dir);
    process.env.HARNESSTAP_HOME = dir;
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    initializeSchema(getDb());
    return dir;
  }

  it("creates and activates a default profile when none exist", () => {
    withHome();
    expect(listProfilePlugins()).toHaveLength(0);

    const result = ensureDefaultProfilePlugin();
    expect(result.created).toBe(true);
    expect(result.plugin.name).toBe("default");
    expect(listProfilePlugins().map((plugin) => plugin.name)).toEqual(["default"]);
    expect(getActiveProfileName()).toBe("default");
  });

  it("attaches distinct library resources to an empty default profile", () => {
    withHome();
    createResource({
      type: "instruction",
      name: "home-agents",
      description: "",
      content: "# Agents",
      metadata: {},
      source: "~/.claude/CLAUDE.md",
      origin_kind: "local_snapshot",
      origin_ref: process.env.HOME,
    });
    createResource({
      type: "skill",
      name: "research",
      description: "",
      content: "# Research",
      metadata: {},
      source: "~/.claude/skills/research/SKILL.md",
      origin_kind: "local_snapshot",
      origin_ref: process.env.HOME,
    });
    createResource({
      type: "plugin",
      name: "skip-me",
      description: "",
      content: "",
      metadata: {},
      source: "marketplace",
      origin_kind: "marketplace_link",
    });

    const result = seedDefaultProfileFromLibrary();
    expect(result.created).toBe(true);
    expect(result.plugin.name).toBe("default");
    const attached = getPluginResources(result.plugin.id);
    expect(attached.map((resource) => resource.type).sort()).toEqual([
      "instruction",
      "skill",
    ]);
    expect(attached.some((resource) => resource.type === "plugin")).toBe(false);
  });

  it("is a no-op when a profile already exists", () => {
    withHome();
    createProfileCommand({ name: "work" });

    const result = ensureDefaultProfilePlugin();
    expect(result.created).toBe(false);
    expect(result.plugin.name).toBe("work");
    expect(listProfilePlugins().map((plugin) => plugin.name)).toEqual(["work"]);
  });
});
