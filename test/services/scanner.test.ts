import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

const pluginImportFixtureRoot = join(import.meta.dirname, "../fixtures/plugin-import");

describe("scanner services", () => {
  it("imports shared AGENTS.md instructions under the shared scan bucket", async () => {
    const context = await createInitializedTestContext("scanner-shared-bucket");

    try {
      writeTextFile(`${context.projectDir}/AGENTS.md`, "# Shared agents instructions");

      const scanner = await import("../../src/services/scanner.ts");
      const results = await scanner.scanProject(context.projectDir);

      expect(scanner.detectPlatforms(context.projectDir)).toEqual([]);
      expect(results).toHaveLength(1);
      expect(results[0]?.platformId).toBe("shared");
      expect(results[0]?.resources).toEqual([
        expect.objectContaining({
          type: "instruction",
          name: "agents-instructions",
          source: "AGENTS.md",
        }),
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("detects platforms and scans a filtered platform", async () => {
    const context = await createInitializedTestContext("scanner-filter");

    try {
      writeTextFile(
        `${context.projectDir}/.claude/skills/shared/SKILL.md`,
        "---\nname: shared\ndescription: Shared skill\n---\n# Shared",
      );
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Claude instructions");
      writeTextFile(
        `${context.projectDir}/AGENTS.md`,
        "# Generic instructions",
      );

      const scanner = await import("../../src/services/scanner.ts");
      const detected = scanner.detectPlatforms(context.projectDir);

      expect(detected).toContain("claude-code");
      expect(detected).not.toContain("codex");

      const results = await scanner.scanProject(
        context.projectDir,
        "claude-code",
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.resources.map((resource) => resource.type)).toEqual(
        expect.arrayContaining(["instruction", "skill"]),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("persistScanResults reports conflict when existing hash differs", async () => {
    const context = await createInitializedTestContext("scanner-conflict");

    try {
      const resourceModel = await import("../../src/models/resource.ts");
      const scanner = await import("../../src/services/scanner.ts");

      resourceModel.upsertResource(
        {
          type: "skill",
          name: "a",
          namespace: "",
          description: "",
          content: "old",
          metadata: {},
          source: "test",
          origin_kind: "local_snapshot",
          origin_ref: context.projectDir,
        },
        { policy: "overwrite" },
      );

      const results = [
        {
          platformId: "cursor",
          resources: [
            {
              type: "skill" as const,
              name: "a",
              description: "",
              content: "new",
              metadata: {},
              source: "test",
            },
          ],
        },
      ];

      const out = scanner.persistScanResults(results, {
        conflictPolicy: "fail",
        originRef: context.projectDir,
      });
      expect(out.conflicts).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("deduplicates resources by type and name when persisting", async () => {
    const context = await createInitializedTestContext("scanner-persist");

    try {
      writeTextFile(
        `${context.projectDir}/.claude/skills/shared/SKILL.md`,
        "---\nname: shared\ndescription: Shared skill\n---\n# Shared",
      );
      writeTextFile(
        `${context.projectDir}/.agents/skills/shared/SKILL.md`,
        "---\nname: shared\ndescription: Shared skill\n---\n# Shared",
      );
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Claude instructions");
      writeTextFile(
        `${context.projectDir}/AGENTS.md`,
        "# Generic instructions",
      );

      const scanner = await import("../../src/services/scanner.ts");
      const persisted = await scanner.scanAndPersist(context.projectDir);

      expect(
        persisted.filter(
          (resource) => resource.type === "skill" && resource.name === "shared",
        ),
      ).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("collapses overlapping AGENTS.md instructions into one canonical imported resource", async () => {
    const context = await createInitializedTestContext("scanner-shared-agents");

    try {
      writeTextFile(`${context.projectDir}/AGENTS.md`, "# Shared agents instructions");

      const scanner = await import("../../src/services/scanner.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      const resources = await scanner.scanAndPersist(context.projectDir);
      const instructions = resources.filter((resource) => resource.type === "instruction");

      expect(instructions).toHaveLength(1);
      expect(instructions[0]?.name).toBe("agents-instructions");
      expect(instructions[0]?.source).toBe("AGENTS.md");
      expect(
        resourceModel.listResources().filter((resource) => resource.source === "AGENTS.md"),
      ).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("respects .harnesstapignore patterns and ! re-inclusion", async () => {
    const context = await createInitializedTestContext("scanner-ignore");

    try {
      writeTextFile(`${context.projectDir}/AGENTS.md`, "# Ignore me");
      writeTextFile(
        `${context.projectDir}/.agents/skills/private-helper/SKILL.md`,
        "---\nname: private-helper\ndescription: Private helper\n---\n# Private helper\n",
      );
      writeTextFile(
        `${context.projectDir}/.agents/skills/shared-helper/SKILL.md`,
        "---\nname: shared-helper\ndescription: Shared helper\n---\n# Shared helper\n",
      );
      writeTextFile(
        `${context.projectDir}/.harnesstapignore`,
        "AGENTS.md\n.agents/skills/*\n!.agents/skills/shared-helper/SKILL.md\n",
      );

      const scanner = await import("../../src/services/scanner.ts");
      const resources = await scanner.scanAndPersist(context.projectDir);

      expect(resources.some((resource) => resource.source === "AGENTS.md")).toBe(
        false,
      );
      expect(
        resources.some((resource) => resource.name === "private-helper"),
      ).toBe(false);
      expect(
        resources.some((resource) => resource.name === "shared-helper"),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("detects and scans default home folders", async () => {
    const context = await createInitializedTestContext("scanner-home-defaults");

    try {
      writeTextFile(
        `${context.homeDir}/.claude/CLAUDE.md`,
        "# Home Claude instructions",
      );
      writeTextFile(
        `${context.homeDir}/.claude/skills/research/SKILL.md`,
        "---\nname: research\ndescription: Home research helper\n---\n# Research",
      );
      writeTextFile(
        `${context.homeDir}/.claude/plugins/CACHE/demo/.claude-plugin/plugin.json`,
        JSON.stringify({ name: "demo", version: "1.0.0" }),
      );
      writeTextFile(
        `${context.homeDir}/.claude/plugins/installed_plugins.json`,
        JSON.stringify({
          version: 2,
          plugins: {
            "demo@demo-market": [
              {
                scope: "user",
                installPath: "CACHE/demo",
                version: "1.0.0",
              },
            ],
          },
        }),
      );

      const scanner = await import("../../src/services/scanner.ts");
      const detected = scanner.detectHomePlatforms();
      const claude = detected.find(
        (result) => result.platformId === "claude-code",
      );

      expect(claude?.discoveredPaths).toEqual(
        expect.arrayContaining([
          "~/.claude/CLAUDE.md",
          "~/.claude/skills/",
          "~/.claude/plugins/",
        ]),
      );

      const results = await scanner.scanHomeDefaults();
      const homeClaude = results.find(
        (result) => result.platformId === "claude-code",
      );

      expect(homeClaude?.resources.map((resource) => resource.type)).toEqual(
        expect.arrayContaining(["instruction", "skill", "plugin_pin"]),
      );
      expect(
        homeClaude?.resources.find((resource) => resource.type === "skill")
          ?.source,
      ).toBe("~/.claude/skills/research/SKILL.md");

      const pin = homeClaude?.resources.find(
        (resource) => resource.type === "plugin_pin",
      );
      expect(pin).toMatchObject({
        name: "demo",
        namespace: "demo-market",
        origin_kind: "marketplace_link",
        origin_ref: "demo@demo-market",
      });

      const persisted = scanner.persistScanResults(results, {
        conflictPolicy: "skip",
        originRef: context.homeDir,
      });
      const savedPin = persisted.resolved.find(
        (resource) => resource.type === "plugin_pin",
      );
      expect(savedPin).toMatchObject({
        name: "demo",
        namespace: "demo-market",
        origin_kind: "marketplace_link",
        origin_ref: "demo@demo-market",
      });
    } finally {
      await context.cleanup();
    }
  });

  it("does not detect cline from shared ~/.agents/skills/ alone", async () => {
    const context = await createInitializedTestContext("scanner-home-shared-agents");

    try {
      writeTextFile(
        `${context.homeDir}/.agents/skills/shared/SKILL.md`,
        "---\nname: shared\ndescription: Shared skill\n---\n# Shared",
      );

      const scanner = await import("../../src/services/scanner.ts");
      const detected = scanner.detectHomePlatforms();
      const platformIds = detected.map((result) => result.platformId);

      expect(platformIds).toContain("warp");
      expect(platformIds).not.toContain("cline");
    } finally {
      await context.cleanup();
    }
  });

  it("detects cline when platform-specific home paths exist", async () => {
    const context = await createInitializedTestContext("scanner-home-cline-specific");

    try {
      writeTextFile(
        `${context.homeDir}/.agents/skills/shared/SKILL.md`,
        "---\nname: shared\ndescription: Shared skill\n---\n# Shared",
      );
      writeTextFile(
        `${context.homeDir}/.cline/data/settings/cline_mcp_settings.json`,
        "{}",
      );

      const scanner = await import("../../src/services/scanner.ts");
      const detected = scanner.detectHomePlatforms();
      const platformIds = detected.map((result) => result.platformId);

      expect(platformIds).toContain("cline");
    } finally {
      await context.cleanup();
    }
  });

  it("detects codex from ~/.codex/ paths without requiring cline", async () => {
    const context = await createInitializedTestContext("scanner-home-codex-specific");

    try {
      writeTextFile(
        `${context.homeDir}/.agents/skills/shared/SKILL.md`,
        "---\nname: shared\ndescription: Shared skill\n---\n# Shared",
      );
      writeTextFile(
        `${context.homeDir}/.codex/config.toml`,
        'model = "gpt-5"\n',
      );

      const scanner = await import("../../src/services/scanner.ts");
      const detected = scanner.detectHomePlatforms();
      const platformIds = detected.map((result) => result.platformId);

      expect(platformIds).toContain("codex");
      expect(platformIds).not.toContain("cline");
    } finally {
      await context.cleanup();
    }
  });

  it("does not import overlapping home defaults on later runs", async () => {
    const context = await createInitializedTestContext("scanner-home-dedup");

    try {
      writeTextFile(
        `${context.homeDir}/.agents/skills/shared/SKILL.md`,
        "---\nname: shared\ndescription: Shared skill\n---\n# Shared",
      );
      writeTextFile(
        `${context.homeDir}/.cursor/skills/shared/SKILL.md`,
        "---\nname: shared\ndescription: Shared skill\n---\n# Shared",
      );

      const scanner = await import("../../src/services/scanner.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      const firstRun = await scanner.scanAndPersistHomeDefaults();
      const secondRun = await scanner.scanAndPersistHomeDefaults();

      expect(
        firstRun.resources.filter(
          (resource) => resource.type === "skill" && resource.name === "shared",
        ),
      ).toHaveLength(1);
      expect(
        secondRun.resources.filter(
          (resource) => resource.type === "skill" && resource.name === "shared",
        ),
      ).toHaveLength(0);
      expect(
        resourceModel
          .listResources()
          .filter(
            (resource) =>
              resource.type === "skill" && resource.name === "shared",
          ),
      ).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("persists imported snapshots for a direct plugin source", async () => {
    const context = await createInitializedTestContext("scanner-plugin-source");

    try {
      const scanner = await import("../../src/services/scanner.ts");
      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );
      const resourceModel = await import("../../src/models/resource.ts");

      const result = await scanner.scanAndPersistPluginSource(
        join(pluginImportFixtureRoot, "cursor-team-kit"),
      );

      expect(result.snapshots).toHaveLength(1);
      expect(result.snapshots[0]).toMatchObject({
        source_kind: "cursor-plugin",
        source_label: "cursor-team-kit",
        plugin_name: "cursor-team-kit",
        plugin_version: "1.4.0",
      });
      expect(result.resources.map((resource) => resource.type)).toEqual(
        expect.arrayContaining(["skill", "agent", "rule"]),
      );
      expect(importedSnapshotModel.listImportedSnapshots()).toHaveLength(1);
      const team = resourceModel.listResources().find((resource) => resource.name === "team");
      expect(team).toMatchObject({
        namespace: "cursor-team-kit",
        origin_kind: "marketplace_link",
        origin_ref: "cursor-team-kit@cursor-team-kit",
      });
      expect(team?.metadata).toMatchObject({
        imported_from: {
          source_label: "cursor-team-kit",
          relative_path: "skills/team/SKILL.md",
        },
      });
    } finally {
      await context.cleanup();
    }
  });

  it("persists one imported snapshot per marketplace plugin entry", async () => {
    const context = await createInitializedTestContext("scanner-plugin-marketplace");

    try {
      const scanner = await import("../../src/services/scanner.ts");
      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );

      const result = await scanner.scanAndPersistPluginSource(
        join(pluginImportFixtureRoot, "marketplace/.cursor-plugin/marketplace.json"),
      );

      expect(result.snapshots).toHaveLength(2);
      expect(result.snapshots.map((snapshot) => snapshot.plugin_name)).toEqual([
        "cursor-team-kit",
        "release-guardian",
      ]);

      const snapshots = importedSnapshotModel.listImportedSnapshots();
      expect(snapshots).toHaveLength(2);
      expect(
        snapshots.find((snapshot) => snapshot.plugin_name === "release-guardian"),
      ).toMatchObject({
        source_kind: "marketplace",
        source_label: "team-marketplace",
        metadata: {
          marketplace_name: "team-marketplace",
          source_plugin_kind: "claude-plugin",
        },
      });
    } finally {
      await context.cleanup();
    }
  });

  it("keeps imported resources distinct when different plugins share the same canonical name", async () => {
    const context = await createInitializedTestContext("scanner-plugin-collision");

    try {
      const scanner = await import("../../src/services/scanner.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      await scanner.scanAndPersistPluginSource(
        join(pluginImportFixtureRoot, "marketplace/.cursor-plugin/marketplace.json"),
      );

      const reviewRules = resourceModel
        .listResources()
        .filter((resource) => resource.type === "rule" && resource.name === "review");
      expect(reviewRules).toHaveLength(2);
      expect(
        reviewRules.map(
          (resource) =>
            resource.metadata?.imported_from?.plugin_name ??
            resource.metadata?.imported_from?.source_label,
        ),
      ).toEqual(expect.arrayContaining(["cursor-team-kit", "release-guardian"]));
    } finally {
      await context.cleanup();
    }
  });

  it("keeps earlier imported snapshots immutable when the same plugin source changes", async () => {
    const context = await createInitializedTestContext("scanner-plugin-refresh");

    try {
      const scanner = await import("../../src/services/scanner.ts");
      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );
      const resourceModel = await import("../../src/models/resource.ts");

      const pluginRoot = join(context.rootDir, "changing-plugin");
      mkdirSync(join(pluginRoot, ".cursor-plugin"), { recursive: true });
      mkdirSync(join(pluginRoot, "skills", "team"), { recursive: true });
      writeFileSync(
        join(pluginRoot, ".cursor-plugin", "plugin.json"),
        JSON.stringify({ name: "changing-plugin", version: "1.0.0" }),
      );
      writeFileSync(
        join(pluginRoot, "skills", "team", "SKILL.md"),
        `---\nname: team\ndescription: First pass\n---\n\nOriginal content\n`,
      );

      await scanner.scanAndPersistPluginSource(pluginRoot);
      const firstSnapshot =
        importedSnapshotModel.listImportedSnapshots().find(
          (snapshot) => snapshot.plugin_name === "changing-plugin",
        ) ?? null;

      writeFileSync(
        join(pluginRoot, "skills", "team", "SKILL.md"),
        `---\nname: team-v2\ndescription: Updated pass\n---\n\nUpdated content\n`,
      );

      await scanner.scanAndPersistPluginSource(pluginRoot);

      const snapshots = importedSnapshotModel
        .listImportedSnapshots()
        .filter((snapshot) => snapshot.plugin_name === "changing-plugin");
      expect(snapshots).toHaveLength(2);
      const latestSnapshot =
        snapshots.find((snapshot) => snapshot.id !== firstSnapshot?.id) ?? null;

      const matching = resourceModel
        .listResources()
        .filter(
          (resource) =>
            resource.type === "skill" &&
            resource.metadata?.imported_from?.plugin_name === "changing-plugin",
        );
      expect(matching).toHaveLength(2);
      expect(
        resourceModel.getResource(firstSnapshot?.resource_ids[0] ?? ""),
      ).toMatchObject({
        name: "team",
        description: "First pass",
        content: "Original content",
      });
      expect(
        matching.map((resource) => resource.name).sort(),
      ).toEqual(["team", "team-v2"]);
      expect(
        resourceModel.getResource(latestSnapshot?.resource_ids[0] ?? ""),
      ).toMatchObject({
        name: "team-v2",
        description: "Updated pass",
        content: "Updated content",
      });
    } finally {
      await context.cleanup();
    }
  });

  it("does not persist resources or snapshots from a malformed plugin manifest", async () => {
    const context = await createInitializedTestContext("scanner-plugin-malformed-manifest");

    try {
      const scanner = await import("../../src/services/scanner.ts");
      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );
      const resourceModel = await import("../../src/models/resource.ts");

      const pluginRoot = join(context.rootDir, "broken-plugin");
      mkdirSync(join(pluginRoot, ".cursor-plugin"), { recursive: true });
      mkdirSync(join(pluginRoot, "skills", "team"), { recursive: true });
      writeFileSync(
        join(pluginRoot, ".cursor-plugin", "plugin.json"),
        "{ invalid json",
      );
      writeFileSync(
        join(pluginRoot, "skills", "team", "SKILL.md"),
        `---\nname: team\n---\n\nShould not import\n`,
      );

      await expect(scanner.scanAndPersistPluginSource(pluginRoot)).rejects.toThrow(
        /Malformed plugin manifest/,
      );
      expect(importedSnapshotModel.listImportedSnapshots()).toHaveLength(0);
      expect(resourceModel.listResources()).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("does not persist resources or snapshots from a parsed plugin manifest missing name", async () => {
    const context = await createInitializedTestContext("scanner-plugin-missing-name");

    try {
      const scanner = await import("../../src/services/scanner.ts");
      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );
      const resourceModel = await import("../../src/models/resource.ts");

      await expect(
        scanner.scanAndPersistPluginSource(
          join(pluginImportFixtureRoot, "missing-name-plugin"),
        ),
      ).rejects.toThrow(/Invalid plugin manifest/);
      expect(importedSnapshotModel.listImportedSnapshots()).toHaveLength(0);
      expect(resourceModel.listResources()).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("does not persist resources or snapshots from a parsed plugin manifest with invalid version", async () => {
    const context = await createInitializedTestContext("scanner-plugin-invalid-version");

    try {
      const scanner = await import("../../src/services/scanner.ts");
      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );
      const resourceModel = await import("../../src/models/resource.ts");

      await expect(
        scanner.scanAndPersistPluginSource(
          join(pluginImportFixtureRoot, "invalid-version-plugin"),
        ),
      ).rejects.toThrow(/Invalid plugin manifest/);
      expect(importedSnapshotModel.listImportedSnapshots()).toHaveLength(0);
      expect(resourceModel.listResources()).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });
});
