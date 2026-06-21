import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { describe, expect, it, mock } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResource } from "../helpers/resources.ts";

describe("applier services", () => {
  it("generates files for multiple platforms", async () => {
    const context = await createInitializedTestContext("applier-generate");

    try {
      const applier = await import("../../src/services/applier.ts");
      const results = await applier.generateFiles(
        [
          makeResource({ type: "instruction", name: "intro", content: "# Intro" }),
          makeResource({ type: "skill", name: "shared", description: "Shared skill" }),
        ],
        ["claude-code", "codex"],
        context.projectDir,
      );

      expect(results.map((result) => result.platformId)).toEqual([
        "claude-code",
        "codex",
      ]);
      expect(results[0]?.files.some((file) => file.path === "CLAUDE.md")).toBe(true);
      expect(results[1]?.files.some((file) => file.path === "AGENTS.md")).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("writes generated files to disk", async () => {
    const context = await createInitializedTestContext("applier-write");

    try {
      const applier = await import("../../src/services/applier.ts");
      applier.writeFiles(
        [{ path: ".claude/skills/demo/SKILL.md", content: "# Demo" }],
        context.projectDir,
      );

      expect(
        readFileSync(`${context.projectDir}/.claude/skills/demo/SKILL.md`, "utf-8"),
      ).toBe("# Demo");
    } finally {
      await context.cleanup();
    }
  });

  it("preserves project writes through symlinked project directories", async () => {
    const context = await createInitializedTestContext("applier-project-symlink");

    try {
      const applier = await import("../../src/services/applier.ts");
      const outsideDir = join(context.rootDir, "claude-home");
      mkdirSync(outsideDir, { recursive: true });
      symlinkSync(outsideDir, join(context.projectDir, ".claude"), "dir");

      applier.writeFiles(
        [{ path: ".claude/skills/demo/SKILL.md", content: "# Demo" }],
        context.projectDir,
      );

      expect(readFileSync(join(outsideDir, "skills/demo/SKILL.md"), "utf-8")).toBe("# Demo");
    } finally {
      await context.cleanup();
    }
  });

  it("materializes files in nested directories", async () => {
    const context = await createInitializedTestContext("applier-nested");

    try {
      const applier = await import("../../src/services/applier.ts");

      applier.writeFiles(
        [{ path: ".claude/skills/research/SKILL.md", content: "# Research" }],
        context.projectDir,
      );

      expect(
        readFileSync(join(context.projectDir, ".claude/skills/research/SKILL.md"), "utf-8"),
      ).toBe("# Research");
    } finally {
      await context.cleanup();
    }
  });

  it("overwrites existing files when writing", async () => {
    const context = await createInitializedTestContext("applier-overwrite");

    try {
      const applier = await import("../../src/services/applier.ts");

      const filePath = join(context.projectDir, "existing.md");
      require("node:fs").writeFileSync(filePath, "old content", "utf-8");

      applier.writeFiles(
        [{ path: "existing.md", content: "new content" }],
        context.projectDir,
      );

      expect(readFileSync(filePath, "utf-8")).toBe("new content");
    } finally {
      await context.cleanup();
    }
  });

  it("applies to project with full pipeline", async () => {
    const context = await createInitializedTestContext("applier-apply");

    try {
      const applier = await import("../../src/services/applier.ts");

      const resources = [
        makeResource({ type: "instruction", name: "intro", content: "# Intro" }),
      ];

      const results = await applier.applyToProject(
        resources,
        ["claude-code"],
        context.projectDir,
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.platformId).toBe("claude-code");
      expect(existsSync(join(context.projectDir, "CLAUDE.md"))).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("handles empty resources list", async () => {
    const context = await createInitializedTestContext("applier-empty");

    try {
      const applier = await import("../../src/services/applier.ts");
      const results = await applier.generateFiles([], ["claude-code"], context.projectDir);

      expect(results).toHaveLength(1);
      expect(results[0]?.files).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("writes files for all generic agents platforms", async () => {
    const context = await createInitializedTestContext("applier-generic");

    try {
      const applier = await import("../../src/services/applier.ts");
      const results = await applier.generateFiles(
        [makeResource({ type: "instruction", name: "warp", content: "# Warp" })],
        ["warp", "amp"],
        context.projectDir,
      );

      expect(results.map((r) => r.platformId)).toEqual(["warp", "amp"]);
      expect(results[0]?.files.some((f) => f.path === "AGENTS.md")).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("applies imported snapshots globally and records ownership for emitted platforms only", async () => {
    const context = await createInitializedTestContext("applier-global-imported");

    try {
      const applier = await import("../../src/services/applier.ts");
      const resources = await import("../../src/models/resource.ts");
      const snapshots = await import("../../src/models/imported-snapshot.ts");

      const mcp = resources.createResource({
        type: "mcp_server",
        name: "demo",
        description: "",
        content: "",
        metadata: { transport: "stdio", command: "npx", args: ["demo-server"] },
        source: "manual",
      });
      const snapshot = snapshots.createImportedSnapshot({
        source_kind: "cursor-plugin",
        source_label: "fixtures/demo",
        plugin_name: "demo-plugin",
        resource_ids: [mcp.id],
        metadata: {},
      });

      const result = await (applier as unknown as {
        applyImportedSnapshotToGlobal: (
          snapshotId: string,
          platforms: string[],
          homeRoot: string,
        ) => Promise<{
          cancelled: boolean;
          results: Array<{ platformId: string; files: Array<{ path: string }> }>;
        }>;
      }).applyImportedSnapshotToGlobal(snapshot.id, ["github-copilot", "cursor"], context.homeDir);

      expect(result.cancelled).toBe(false);
      expect(existsSync(join(context.homeDir, ".copilot/mcp-config.json"))).toBe(true);
      expect(existsSync(join(context.homeDir, ".cursor/mcp.json"))).toBe(true);

      const installs = snapshots.listImportedSnapshotInstalls(snapshot.id);
      expect(installs).toHaveLength(2);
      expect(installs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            platform_id: "github-copilot",
            files: [".copilot/mcp-config.json"],
          }),
          expect.objectContaining({
            platform_id: "cursor",
            files: [".cursor/mcp.json"],
          }),
        ]),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("prompts on owned global conflicts before writing", async () => {
    const context = await createInitializedTestContext("applier-global-conflict");

    try {
      const applier = await import("../../src/services/applier.ts");
      const snapshots = await import("../../src/models/imported-snapshot.ts");

      const ownerSnapshot = snapshots.createImportedSnapshot({
        source_kind: "cursor-plugin",
        source_label: "fixtures/owner",
        plugin_name: "owner-plugin",
        resource_ids: [],
        metadata: {},
      });
      snapshots.recordImportedSnapshotInstall({
        snapshot_id: ownerSnapshot.id,
        platform_id: "copilot-cli",
        files: [".copilot/skills/research/SKILL.md"],
      });

      const targetPath = join(context.homeDir, ".copilot/skills/research/SKILL.md");
      require("node:fs").mkdirSync(join(context.homeDir, ".copilot/skills/research"), {
        recursive: true,
      });
      require("node:fs").writeFileSync(targetPath, "existing", "utf-8");

      const resolver = mock(async (conflict: {
        path: string;
        owners: Array<{ snapshot_id: string; plugin_name: string; platform_id: string }>;
      }) => {
        expect(conflict.path).toBe(".copilot/skills/research/SKILL.md");
        expect(conflict.owners).toEqual([
          expect.objectContaining({
            snapshot_id: ownerSnapshot.id,
            plugin_name: "owner-plugin",
            platform_id: "copilot-cli",
          }),
        ]);
        return "skip";
      });

      const result = await (applier as unknown as {
        applyToGlobal: (
          resources: ReturnType<typeof makeResource>[],
          platforms: string[],
          homeRoot: string,
          options: {
            conflictResolver: typeof resolver;
          },
        ) => Promise<{ cancelled: boolean; skippedFiles: string[] }>;
      }).applyToGlobal(
        [
          makeResource({
            type: "skill",
            name: "research",
            description: "Research helper",
            content: "# Research",
          }),
        ],
        ["copilot-cli"],
        context.homeDir,
        { conflictResolver: resolver },
      );

      expect(result.cancelled).toBe(false);
      expect(result.skippedFiles).toEqual([".copilot/skills/research/SKILL.md"]);
      expect(readFileSync(targetPath, "utf-8")).toBe("existing");
      expect(resolver).toHaveBeenCalledTimes(1);
    } finally {
      await context.cleanup();
    }
  });

  it("does not prompt when an existing file already matches generated content", async () => {
    const context = await createInitializedTestContext("applier-global-identical-content");

    try {
      const applier = await import("../../src/services/applier.ts");
      const resources = [
        makeResource({
          type: "skill",
          name: "research",
          description: "Research helper",
          content: "# Research",
        }),
      ];
      const [generated] = await applier.generateFiles(
        resources,
        ["copilot-cli"],
        context.homeDir,
        { target: "global" },
      );
      const targetPath = join(context.homeDir, generated.files[0].path);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, generated.files[0].content, "utf-8");

      const resolver = mock(async () => "replace" as const);

      const result = await applier.applyToGlobal(
        resources,
        ["copilot-cli"],
        context.homeDir,
        { conflictResolver: resolver },
      );

      expect(result.cancelled).toBe(false);
      expect(result.conflicts).toEqual([]);
      expect(result.writtenFiles).toEqual([generated.files[0].path]);
      expect(resolver).not.toHaveBeenCalled();
      expect(readFileSync(targetPath, "utf-8")).toBe(generated.files[0].content);
    } finally {
      await context.cleanup();
    }
  });

  it("cancels global apply before writing any files", async () => {
    const context = await createInitializedTestContext("applier-global-cancel");

    try {
      const applier = await import("../../src/services/applier.ts");
      const targetPath = join(context.homeDir, ".copilot/skills/research/SKILL.md");
      require("node:fs").mkdirSync(join(context.homeDir, ".copilot/skills/research"), {
        recursive: true,
      });
      require("node:fs").writeFileSync(targetPath, "existing", "utf-8");

      const result = await (applier as unknown as {
        applyToGlobal: (
          resources: ReturnType<typeof makeResource>[],
          platforms: string[],
          homeRoot: string,
          options: {
            conflictResolver: (conflict: { path: string }) => Promise<"cancel">;
          },
        ) => Promise<{ cancelled: boolean }>;
      }).applyToGlobal(
        [
          makeResource({
            type: "skill",
            name: "research",
            description: "Research helper",
            content: "# Research",
          }),
        ],
        ["copilot-cli", "codex"],
        context.homeDir,
        {
          conflictResolver: async (conflict) => {
            expect(conflict.path).toBe(".copilot/skills/research/SKILL.md");
            return "cancel";
          },
        },
      );

      expect(result.cancelled).toBe(true);
      expect(readFileSync(targetPath, "utf-8")).toBe("existing");
      expect(existsSync(join(context.homeDir, ".agents/skills/research/SKILL.md"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("cancels prompt-policy global apply without a resolver before writing any files", async () => {
    const context = await createInitializedTestContext("applier-global-default-prompt");

    try {
      const applier = await import("../../src/services/applier.ts");
      const targetPath = join(context.homeDir, ".copilot/skills/research/SKILL.md");
      mkdirSync(join(context.homeDir, ".copilot/skills/research"), { recursive: true });
      writeFileSync(targetPath, "existing", "utf-8");

      const result = await applier.applyToGlobal(
        [
          makeResource({
            type: "skill",
            name: "research",
            description: "Research helper",
            content: "# Research",
          }),
        ],
        ["copilot-cli", "codex"],
        context.homeDir,
      );

      expect(result.cancelled).toBe(true);
      expect(result.conflicts.map((conflict) => conflict.path)).toEqual([
        ".copilot/skills/research/SKILL.md",
      ]);
      expect(readFileSync(targetPath, "utf-8")).toBe("existing");
      expect(existsSync(join(context.homeDir, ".agents/skills/research/SKILL.md"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("forces global target paths even when a project target override is supplied", async () => {
    const context = await createInitializedTestContext("applier-global-force-target");

    try {
      const applier = await import("../../src/services/applier.ts");

      await applier.applyToGlobal(
        [
          makeResource({
            type: "instruction",
            name: "codex",
            content: "# Global Codex",
          }),
        ],
        ["codex"],
        context.homeDir,
        { conflictPolicy: "replace", target: "project" },
      );

      expect(existsSync(join(context.homeDir, ".codex/AGENTS.md"))).toBe(true);
      expect(existsSync(join(context.homeDir, "AGENTS.md"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("stops prompting after the first cancel decision", async () => {
    const context = await createInitializedTestContext("applier-global-cancel-stop");

    try {
      const applier = await import("../../src/services/applier.ts");
      mkdirSync(join(context.homeDir, ".copilot/skills/research"), { recursive: true });
      mkdirSync(join(context.homeDir, ".agents/skills/research"), { recursive: true });
      writeFileSync(join(context.homeDir, ".copilot/skills/research/SKILL.md"), "existing", "utf-8");
      writeFileSync(join(context.homeDir, ".agents/skills/research/SKILL.md"), "existing", "utf-8");

      const resolver = mock(async () => "cancel" as const);

      const result = await applier.applyToGlobal(
        [
          makeResource({
            type: "skill",
            name: "research",
            description: "Research helper",
            content: "# Research",
          }),
        ],
        ["copilot-cli", "codex"],
        context.homeDir,
        { conflictResolver: resolver },
      );

      expect(result.cancelled).toBe(true);
      expect(resolver).toHaveBeenCalledTimes(1);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects global writes that escape through symlinked directories", async () => {
    const context = await createInitializedTestContext("applier-global-symlink");

    try {
      const applier = await import("../../src/services/applier.ts");
      const outsideDir = join(context.rootDir, "outside");
      mkdirSync(outsideDir, { recursive: true });
      symlinkSync(outsideDir, join(context.homeDir, ".copilot"), "dir");

      await expect(
        applier.materializeFiles(
          [{ path: ".copilot/mcp-config.json", content: "{}" }],
          context.homeDir,
        ),
      ).rejects.toThrow(/outside root|symlink/i);

      expect(existsSync(join(outsideDir, "mcp-config.json"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects global writes to symlinked file targets that escape the home root", async () => {
    const context = await createInitializedTestContext("applier-global-file-symlink");

    try {
      const applier = await import("../../src/services/applier.ts");
      const outsideFile = join(context.rootDir, "outside-file.json");
      mkdirSync(join(context.homeDir, ".copilot"), { recursive: true });
      writeFileSync(outsideFile, '{"outside":true}', "utf-8");
      symlinkSync(outsideFile, join(context.homeDir, ".copilot/mcp-config.json"), "file");

      await expect(
        applier.materializeFiles(
          [{ path: ".copilot/mcp-config.json", content: "{}" }],
          context.homeDir,
          { conflictPolicy: "replace" },
        ),
      ).rejects.toThrow(/outside root|symlink/i);

      expect(readFileSync(outsideFile, "utf-8")).toBe('{"outside":true}');
    } finally {
      await context.cleanup();
    }
  });

  it("preserves ownership for skipped files on partial snapshot reapply", async () => {
    const context = await createInitializedTestContext("applier-global-ownership");

    try {
      const applier = await import("../../src/services/applier.ts");
      const resources = await import("../../src/models/resource.ts");
      const snapshots = await import("../../src/models/imported-snapshot.ts");

      const skill = resources.createResource({
        type: "skill",
        name: "research",
        description: "Research helper",
        content: "# Research",
        metadata: {},
        source: "manual",
      });
      const mcp = resources.createResource({
        type: "mcp_server",
        name: "demo",
        description: "",
        content: "",
        metadata: { transport: "stdio", command: "npx", args: ["demo-server"] },
        source: "manual",
      });
      const snapshot = snapshots.createImportedSnapshot({
        source_kind: "cursor-plugin",
        source_label: "fixtures/demo",
        plugin_name: "demo-plugin",
        resource_ids: [skill.id, mcp.id],
        metadata: {},
      });

      await applier.applyImportedSnapshotToGlobal(
        snapshot.id,
        ["copilot-cli"],
        context.homeDir,
        { conflictPolicy: "replace" },
      );

      const skillPath = join(context.homeDir, ".copilot/skills/research/SKILL.md");
      writeFileSync(skillPath, "keep me", "utf-8");

      const result = await applier.applyImportedSnapshotToGlobal(
        snapshot.id,
        ["copilot-cli"],
        context.homeDir,
        {
          conflictResolver: async (conflict) =>
            conflict.path === ".copilot/skills/research/SKILL.md" ? "skip" : "replace",
        },
      );

      expect(result.cancelled).toBe(false);
      expect(result.skippedFiles).toContain(".copilot/skills/research/SKILL.md");

      const installs = snapshots.listImportedSnapshotInstalls(snapshot.id);
      expect(installs).toEqual([
        expect.objectContaining({
          platform_id: "copilot-cli",
          files: expect.arrayContaining([
            ".copilot/skills/research/SKILL.md",
            ".copilot/mcp-config.json",
          ]),
        }),
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("reapplies the same imported snapshot without self-conflicting", async () => {
    const context = await createInitializedTestContext("applier-global-self-reapply");

    try {
      const applier = await import("../../src/services/applier.ts");
      const resources = await import("../../src/models/resource.ts");
      const snapshots = await import("../../src/models/imported-snapshot.ts");

      const skill = resources.createResource({
        type: "skill",
        name: "research",
        description: "Research helper",
        content: "# Research",
        metadata: {},
        source: "manual",
      });
      const snapshot = snapshots.createImportedSnapshot({
        source_kind: "cursor-plugin",
        source_label: "fixtures/demo",
        plugin_name: "demo-plugin",
        resource_ids: [skill.id],
        metadata: {},
      });

      await applier.applyImportedSnapshotToGlobal(
        snapshot.id,
        ["copilot-cli"],
        context.homeDir,
        { conflictPolicy: "replace" },
      );

      const result = await applier.applyImportedSnapshotToGlobal(
        snapshot.id,
        ["copilot-cli"],
        context.homeDir,
      );

      expect(result.cancelled).toBe(false);
      expect(result.conflicts).toEqual([]);
      expect(result.writtenFiles).toContain(".copilot/skills/research/SKILL.md");
    } finally {
      await context.cleanup();
    }
  });

  it("removes replaced files from older snapshot ownership records", async () => {
    const context = await createInitializedTestContext("applier-global-owner-replace");

    try {
      const applier = await import("../../src/services/applier.ts");
      const resources = await import("../../src/models/resource.ts");
      const snapshots = await import("../../src/models/imported-snapshot.ts");

      const skillA = resources.createResource({
        type: "skill",
        name: "research",
        namespace: "plugin-a",
        description: "Research helper",
        content: "# Research A",
        metadata: {},
        source: "manual",
      });
      const snapshotA = snapshots.createImportedSnapshot({
        source_kind: "cursor-plugin",
        source_label: "fixtures/a",
        plugin_name: "plugin-a",
        resource_ids: [skillA.id],
        metadata: {},
      });

      const skillB = resources.createResource({
        type: "skill",
        name: "research",
        namespace: "plugin-b",
        description: "Research helper",
        content: "# Research B",
        metadata: {},
        source: "manual",
      });
      const snapshotB = snapshots.createImportedSnapshot({
        source_kind: "cursor-plugin",
        source_label: "fixtures/b",
        plugin_name: "plugin-b",
        resource_ids: [skillB.id],
        metadata: {},
      });

      await applier.applyImportedSnapshotToGlobal(
        snapshotA.id,
        ["copilot-cli"],
        context.homeDir,
        { conflictPolicy: "replace" },
      );
      await applier.applyImportedSnapshotToGlobal(
        snapshotB.id,
        ["copilot-cli"],
        context.homeDir,
        { conflictPolicy: "replace" },
      );

      expect(
        snapshots.findImportedSnapshotOwnersByFile(".copilot/skills/research/SKILL.md"),
      ).toEqual([
        expect.objectContaining({
          snapshot_id: snapshotB.id,
          plugin_name: "plugin-b",
          platform_id: "copilot-cli",
        }),
      ]);
      expect(snapshots.listImportedSnapshotInstalls(snapshotA.id)).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
