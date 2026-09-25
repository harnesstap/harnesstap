import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { getPlatform } from "../../src/platforms/registry.ts";
import {
  classifyDiskPresence,
  inventoryLocationsForPlatform,
  locationForSource,
  locationsForPlatform,
  sourceWithinLocation,
} from "../../src/services/harness-inventory.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const HOME = "/home/tester";

describe("locationsForPlatform", () => {
  it("groups claude-code project keys that share settings.json into one location", () => {
    const claude = getPlatform("claude-code");
    if (!claude) throw new Error("claude-code missing from registry");

    const settings = locationsForPlatform(claude.projectPaths).find(
      (location) => location.path === ".claude/settings.json",
    );

    expect(settings).toEqual({
      path: ".claude/settings.json",
      surfaces: ["permissions", "hooks", "settings"],
      alternates: [],
    });
  });

  it("lists claude-code global paths in registry order with no alternates", () => {
    const claude = getPlatform("claude-code");
    if (!claude) throw new Error("claude-code missing from registry");

    expect(locationsForPlatform(claude.globalPaths)).toEqual([
      { path: "~/.claude/CLAUDE.md", surfaces: ["instructions"], alternates: [] },
      { path: "~/.claude/skills/", surfaces: ["skills"], alternates: [] },
      { path: "~/.claude/rules/", surfaces: ["rules"], alternates: [] },
      { path: "~/.claude.json", surfaces: ["mcp"], alternates: [] },
      { path: "~/.claude/agents/", surfaces: ["agents"], alternates: [] },
      { path: "~/.claude/commands/", surfaces: ["commands"], alternates: [] },
      { path: "~/.claude/settings.json", surfaces: ["settings"], alternates: [] },
      { path: "~/.claude/plugins/", surfaces: ["plugins"], alternates: [] },
    ]);
  });

  it("folds legacy keys and pathAlternates into match-only alternates", () => {
    expect(
      locationsForPlatform({
        instructions: "AGENTS.md",
        legacy_instructions: ".cursorrules",
        rules: ".cursor/rules/",
        legacy_rules: ".cursorrules",
        pathAlternates: {
          rules: [".cursor/rules.md", ".cursor/rules/"],
          commands: [".cursor/commands/"],
        },
      }),
    ).toEqual([
      { path: "AGENTS.md", surfaces: ["instructions"], alternates: [".cursorrules"] },
      {
        path: ".cursor/rules/",
        surfaces: ["rules"],
        alternates: [".cursorrules", ".cursor/rules.md"],
      },
    ]);
  });
});

describe("inventoryLocationsForPlatform", () => {
  it("adds Cursor plugins, app-managed skills, shared ~/.agents, and Claude-related paths", () => {
    const cursor = getPlatform("cursor");
    if (!cursor) throw new Error("cursor missing from registry");

    const paths = inventoryLocationsForPlatform(cursor).map((location) => ({
      path: location.path,
      surfaces: location.surfaces,
      relation: location.relation,
      relatedFrom: location.relatedFrom ?? null,
    }));

    expect(paths).toEqual([
      { path: "~/.cursor/rules/", surfaces: ["rules"], relation: "native", relatedFrom: null },
      { path: "~/.cursor/skills/", surfaces: ["skills"], relation: "native", relatedFrom: null },
      { path: "~/.cursor/mcp.json", surfaces: ["settings"], relation: "native", relatedFrom: null },
      { path: "~/.cursor/agents/", surfaces: ["agents"], relation: "native", relatedFrom: null },
      { path: "~/.cursor/hooks.json", surfaces: ["hooks"], relation: "native", relatedFrom: null },
      { path: "~/.cursor/plugins/", surfaces: ["plugins"], relation: "native", relatedFrom: null },
      {
        path: "~/.cursor/skills-cursor/",
        surfaces: ["skills"],
        relation: "host-managed",
        relatedFrom: null,
      },
      { path: "~/.agents/skills/", surfaces: ["skills"], relation: "shared", relatedFrom: null },
      {
        path: "~/.claude/plugins/",
        surfaces: ["plugins"],
        relation: "related",
        relatedFrom: "Claude Code",
      },
      {
        path: "~/.claude/skills/",
        surfaces: ["skills"],
        relation: "related",
        relatedFrom: "Claude Code",
      },
    ]);
  });

  it("lists ~/.agents/skills as shared for project .agents harnesses without that global path", () => {
    const pi = getPlatform("pi");
    if (!pi) throw new Error("pi missing from registry");
    expect(
      inventoryLocationsForPlatform(pi).find((location) => location.path === "~/.agents/skills/"),
    ).toEqual({
      path: "~/.agents/skills/",
      surfaces: ["skills"],
      alternates: [],
      relation: "shared",
    });
  });

  it("lists OpenCode native skills plus related agents and Claude trees", () => {
    const opencode = getPlatform("opencode");
    if (!opencode) throw new Error("opencode missing from registry");

    expect(locationsForPlatform(opencode.projectPaths).find((location) => location.path === ".opencode/skills/")).toEqual({
      path: ".opencode/skills/",
      surfaces: ["skills"],
      alternates: [".agents/skills/"],
    });

    const paths = inventoryLocationsForPlatform(opencode).map((location) => ({
      path: location.path,
      surfaces: location.surfaces,
      relation: location.relation,
    }));

    expect(paths).toEqual(
      expect.arrayContaining([
        { path: "~/.config/opencode/skills/", surfaces: ["skills"], relation: "native" },
        { path: "~/.agents/skills/", surfaces: ["skills"], relation: "shared" },
        { path: "~/.claude/skills/", surfaces: ["skills"], relation: "related" },
      ]),
    );
  });
});

describe("sourceWithinLocation", () => {
  const skills = { path: "~/.claude/skills/", alternates: [] };
  const settings = { path: "~/.claude/settings.json", alternates: [] };

  it("matches a skill file under the skills directory", () => {
    expect(
      sourceWithinLocation("~/.claude/skills/foo/SKILL.md", skills, HOME),
    ).toBe(true);
  });

  it("matches an absolute source under the home root", () => {
    expect(
      sourceWithinLocation(`${HOME}/.claude/skills/foo/SKILL.md`, skills, HOME),
    ).toBe(true);
  });

  it("does not match a traversal source", () => {
    expect(
      sourceWithinLocation("~/.claude/skills/../rules/foo.md", skills, HOME),
    ).toBe(false);
  });

  it("does not match an absolute source outside the home root", () => {
    expect(
      sourceWithinLocation("/srv/other/.claude/skills/foo/SKILL.md", skills, HOME),
    ).toBe(false);
  });

  it("matches a file path exactly and not by prefix", () => {
    expect(sourceWithinLocation("~/.claude/settings.json", settings, HOME)).toBe(true);
    expect(sourceWithinLocation("~/.claude/settings.json.bak", settings, HOME)).toBe(
      false,
    );
  });

  it("matches through a match-only alternate", () => {
    expect(
      sourceWithinLocation(
        "~/.codex/prompts/review.md",
        { path: "~/.codex/commands/", alternates: ["~/.codex/prompts/"] },
        HOME,
      ),
    ).toBe(true);
  });
});

describe("locationForSource", () => {
  it("assigns a skill to the longest matching location, not a shorter prefix", () => {
    const shorter = { path: "~/.claude/", alternates: [] };
    const skills = { path: "~/.claude/skills/", alternates: [] };

    expect(
      locationForSource("~/.claude/skills/foo/SKILL.md", [shorter, skills], HOME),
    ).toBe(skills);
  });

  it("returns null when nothing matches", () => {
    expect(
      locationForSource(
        "~/.cursor/rules/foo.mdc",
        [{ path: "~/.claude/skills/", alternates: [] }],
        HOME,
      ),
    ).toBe(null);
  });
});

describe("classifyDiskPresence", () => {
  const shared = new Set(["~/.agents/skills/"]);

  it("is detected when the scanner reported the harness", () => {
    expect(
      classifyDiskPresence({ detected: true, existingPaths: [], sharedGlobalPaths: shared }),
    ).toBe("detected");
  });

  it("is shared-only when every existing path is a shared global path", () => {
    expect(
      classifyDiskPresence({
        detected: false,
        existingPaths: ["~/.agents/skills/"],
        sharedGlobalPaths: shared,
      }),
    ).toBe("shared-only");
  });

  it("is absent when no declared path exists", () => {
    expect(
      classifyDiskPresence({ detected: false, existingPaths: [], sharedGlobalPaths: shared }),
    ).toBe("absent");
  });
});

describe("getHarnessInventory", () => {
  it("annotates disk presence and groups home-origin rows into locations", async () => {
    const context = await createInitializedTestContext("harness-inventory");
    try {
      const { getHarnessInventory } = await import(
        "../../src/services/harness-inventory.ts"
      );
      const { createResource } = await import("../../src/models/resource.ts");
      const { setHarnessPreference } = await import("../../src/models/harness.ts");

      const skillDir = join(context.homeDir, ".claude", "skills", "foo");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), "---\nname: foo\n---\nbody\n");

      setHarnessPreference({ main_harness: "claude-code", alias_harnesses: ["cursor"] });
      const skill = createResource({
        type: "skill",
        name: "foo",
        description: "A skill",
        content: "body",
        metadata: {},
        source: "~/.claude/skills/foo/SKILL.md",
        origin_ref: context.homeDir,
      });
      createResource({
        type: "rule",
        name: "elsewhere",
        description: "",
        content: "x",
        metadata: { globs: [], always_apply: false },
        source: "~/.claude/rules/elsewhere.md",
        origin_ref: "/some/project",
      });

      createResource({
        type: "plugin",
        name: "demo",
        namespace: "official",
        description: "Plugin pin: demo@official",
        content: "{}",
        metadata: {},
        source: "~/.claude/plugins/installed_plugins.json",
        origin_kind: "marketplace_link",
        origin_ref: "demo@official",
      });

      const inventory = getHarnessInventory(context.homeDir);
      const claude = inventory.harnesses.find((entry) => entry.id === "claude-code");
      const cursor = inventory.harnesses.find((entry) => entry.id === "cursor");
      const aider = inventory.harnesses.find((entry) => entry.id === "aider");

      expect(inventory.global).toEqual({
        main_harness: "claude-code",
        alias_harnesses: ["cursor"],
      });
      expect(inventory.root).toBe(context.homeDir);
      expect(claude?.disk).toBe("detected");
      expect(
      claude?.locations.find((location) => location.path === "~/.claude/skills/"),
    ).toEqual({
        path: "~/.claude/skills/",
        surfaces: ["skills"],
        on_disk: true,
        relation: "native",
        resources: [
          {
            id: skill.id,
            type: "skill",
            name: "foo",
            description: "A skill",
            source: "~/.claude/skills/foo/SKILL.md",
          },
        ],
      });
      expect(
        claude?.locations.find((location) => location.path === "~/.claude/rules/"),
      ).toEqual({
        path: "~/.claude/rules/",
        surfaces: ["rules"],
        on_disk: false,
        relation: "native",
        resources: [],
      });
      expect(cursor?.disk).toBe("absent");
      expect(cursor?.locations.map((location) => location.path)).toEqual([
        "~/.cursor/rules/",
        "~/.cursor/skills/",
        "~/.cursor/mcp.json",
        "~/.cursor/agents/",
        "~/.cursor/hooks.json",
        "~/.cursor/plugins/",
        "~/.cursor/skills-cursor/",
        "~/.agents/skills/",
        "~/.claude/plugins/",
        "~/.claude/skills/",
      ]);
      expect(
        cursor?.locations.find((location) => location.path === "~/.claude/plugins/"),
      ).toMatchObject({
        relation: "related",
        related_from: "Claude Code",
        resources: [
          expect.objectContaining({
            type: "plugin",
            name: "demo",
            source: "~/.claude/plugins/installed_plugins.json",
          }),
        ],
      });
      expect(
        cursor?.locations.find((location) => location.path === "~/.claude/skills/"),
      ).toMatchObject({
        relation: "related",
        related_from: "Claude Code",
        resources: [
          expect.objectContaining({
            type: "skill",
            name: "foo",
            source: "~/.claude/skills/foo/SKILL.md",
          }),
        ],
      });
      expect(
        cursor?.locations.find((location) => location.path === "~/.agents/skills/"),
      ).toMatchObject({ relation: "shared", surfaces: ["skills"] });
      expect(aider).toEqual({
        id: "aider",
        name: "Aider",
        supported: false,
        supports: ["instructions"],
        disk: "absent",
        locations: [],
      });
    } finally {
      await context.cleanup();
    }
  });
});
