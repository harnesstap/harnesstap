import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { writeTextFile } from "../helpers/fs.ts";

const pluginImportFixtureRoot = join(import.meta.dirname, "../fixtures/plugin-import");

describe("CLI scan", () => {
  it("imports detected project resources and registers the project", async () => {
    const context = await createTestContext("cli-scan");

    try {
      initGitRepo(context.projectDir);
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Claude instructions");
      writeTextFile(
        `${context.projectDir}/.claude/skills/research/SKILL.md`,
        "---\nname: research\ndescription: Research helper\n---\n# Research\n",
      );

      await runCli(["init"]);
      const result = await runCli(["project", "scan", context.projectDir]);

      const resourceModel = await import("../../src/models/resource.ts");
      const projectModel = await import("../../src/models/project.ts");

      // Per-platform verdict output
      expect(result.stdout).toContain("claude-code");
      // Proper singular/plural: "1 resource" not "1 resources"
      expect(result.stdout).toMatch(/\d+ resources?/);
      expect(result.stdout).not.toContain("1 resources");
      // Project registration verdict
      expect(result.stdout).toContain("Project registered");
      expect(resourceModel.listResources().length).toBeGreaterThan(0);
      expect(
        projectModel.getProjectByOrigin("git@github.com:acme/harnessdeck-fixture.git"),
      ).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });

  it("shows dry-run prefix in human mode without persisting", async () => {
    const context = await createTestContext("cli-scan-dry");

    try {
      initGitRepo(context.projectDir);
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Dry run test");

      await runCli(["init"]);
      const result = await runCli(["project", "scan", context.projectDir, "--dry-run"]);

      // Dry-run uses [dry run] prefix
      expect(result.stdout).toContain("[dry run]");
      expect(result.stdout).toContain("claude-code");
      // No project registration in dry-run
      expect(result.stdout).not.toContain("Project registered");
    } finally {
      await context.cleanup();
    }
  });

  it("removes stale synthetic AGENTS.md duplicates on a rescan", async () => {
    const context = await createTestContext("cli-scan-shared-agents-cleanup");

    try {
      initGitRepo(context.projectDir);
      writeTextFile(`${context.projectDir}/AGENTS.md`, "# Shared agents instructions");

      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");

      resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "kode-instructions",
          content: "# Shared agents instructions",
          source: "AGENTS.md",
        }),
      );
      resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "codex-instructions",
          content: "# Shared agents instructions",
          source: "AGENTS.md",
        }),
      );

      await runCli(["project", "scan", context.projectDir]);

      const names = resourceModel
        .listResources()
        .filter((resource) => resource.source === "AGENTS.md")
        .map((resource) => resource.name);

      expect(names).toEqual(["agents-instructions"]);
    } finally {
      await context.cleanup();
    }
  });

  it("imports plugin marketplace manifests", async () => {
    const context = await createTestContext("cli-scan-plugin-marketplace");

    try {
      await runCli(["init"]);

      await runCli([
        "project",
        "scan",
        join(pluginImportFixtureRoot, "marketplace/.cursor-plugin/marketplace.json"),
      ]);

      const resourceModel = await import("../../src/models/resource.ts");
      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );

      expect(importedSnapshotModel.listImportedSnapshots()).toHaveLength(2);
      expect(
        importedSnapshotModel.listImportedSnapshots().map((snapshot) => snapshot.plugin_name),
      ).toEqual(expect.arrayContaining(["release-guardian", "cursor-team-kit"]));
      expect(
        resourceModel.listResources().some((resource) =>
          resource.metadata?.imported_from?.source_label === "team-marketplace"
        ),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("warns that global install is skipped during plugin-source dry runs", async () => {
    const context = await createTestContext("cli-scan-plugin-dry-run-global");

    try {
      await runCli(["init"]);

      const result = await runCli([
        "project",
        "scan",
        join(pluginImportFixtureRoot, "cursor-team-kit"),
        "--dry-run",
        "--global",
      ]);

      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );

      expect(result.stdout).toContain("[dry run]");
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        "--global is ignored with --dry-run",
      );
      expect(importedSnapshotModel.listImportedSnapshots()).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("globally installs imported plugin resources to preferred harnesses", async () => {
    const context = await createTestContext("cli-scan-plugin-global-defaults");

    try {
      await runCli(["init"]);
      await runCli([
        "harness",
        "set",
        "--main",
        "copilot-cli",
        "--aliases",
        "cursor",
      ]);

      const result = await runCli([
        "project",
        "scan",
        join(pluginImportFixtureRoot, "cursor-team-kit"),
        "--global",
      ]);

      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );
      const installs = importedSnapshotModel.listImportedSnapshotInstalls(
        importedSnapshotModel.listImportedSnapshots()[0]?.id ?? "",
      );

      expect(result.stdout).toContain("copilot-cli");
      expect(result.stdout).toContain("cursor");
      expect(
        existsSync(join(context.homeDir, ".copilot/skills/team/SKILL.md")),
      ).toBe(true);
      expect(
        existsSync(join(context.homeDir, ".cursor/skills/team/SKILL.md")),
      ).toBe(true);
      expect(installs.map((install) => install.platform_id).sort()).toEqual([
        "copilot-cli",
        "cursor",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("uses explicit scan harness targets instead of preferred defaults", async () => {
    const context = await createTestContext("cli-scan-plugin-global-explicit");

    try {
      await runCli(["init"]);
      await runCli([
        "harness",
        "set",
        "--main",
        "copilot-cli",
        "--aliases",
        "cursor",
      ]);

      const result = await runCli([
        "project",
        "scan",
        join(pluginImportFixtureRoot, "cursor-team-kit"),
        "--global",
        "--harness",
        "github-copilot",
      ]);

      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );
      const installs = importedSnapshotModel.listImportedSnapshotInstalls(
        importedSnapshotModel.listImportedSnapshots()[0]?.id ?? "",
      );

      expect(result.stdout).toContain("github-copilot");
      expect(
        existsSync(join(context.homeDir, ".copilot/skills/team/SKILL.md")),
      ).toBe(true);
      expect(
        existsSync(join(context.homeDir, ".cursor/skills/team/SKILL.md")),
      ).toBe(false);
      expect(installs.map((install) => install.platform_id)).toEqual([
        "github-copilot",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("reapplies an imported plugin globally when rescanned", async () => {
    const context = await createTestContext("cli-scan-plugin-global-rescan");

    try {
      await runCli(["init"]);
      await runCli([
        "harness",
        "set",
        "--main",
        "copilot-cli",
        "--aliases",
        "cursor",
      ]);

      await runCli([
        "project",
        "scan",
        join(pluginImportFixtureRoot, "cursor-team-kit"),
        "--global",
      ]);
      const secondResult = await runCli([
        "project",
        "scan",
        join(pluginImportFixtureRoot, "cursor-team-kit"),
        "--global",
      ]);

      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );
      const snapshots = importedSnapshotModel.listImportedSnapshots();
      const latestSnapshot = snapshots[0];

      expect(secondResult.stdout).toContain("Installed cursor-team-kit globally");
      expect(snapshots).toHaveLength(2);
      expect(
        importedSnapshotModel
          .listImportedSnapshotInstalls(latestSnapshot?.id ?? "")
          .map((install) => install.platform_id)
          .sort(),
      ).toEqual(["copilot-cli", "cursor"]);
      expect(
        importedSnapshotModel.findImportedSnapshotOwnersByFile(
          ".copilot/skills/team/SKILL.md",
        ),
      ).toEqual([
        expect.objectContaining({
          snapshot_id: latestSnapshot?.id,
          platform_id: "copilot-cli",
          plugin_name: "cursor-team-kit",
        }),
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("removes stale global installs when rescanning to a narrower harness set", async () => {
    const context = await createTestContext("cli-scan-plugin-global-retarget");

    try {
      await runCli(["init"]);
      await runCli([
        "harness",
        "set",
        "--main",
        "copilot-cli",
        "--aliases",
        "cursor",
      ]);

      await runCli([
        "project",
        "scan",
        join(pluginImportFixtureRoot, "cursor-team-kit"),
        "--global",
      ]);
      await runCli([
        "project",
        "scan",
        join(pluginImportFixtureRoot, "cursor-team-kit"),
        "--global",
        "--harness",
        "copilot-cli",
      ]);

      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );

      expect(
        existsSync(join(context.homeDir, ".copilot/skills/team/SKILL.md")),
      ).toBe(true);
      expect(
        existsSync(join(context.homeDir, ".cursor/skills/team/SKILL.md")),
      ).toBe(false);
      expect(
        importedSnapshotModel.findImportedSnapshotOwnersByFile(
          ".cursor/skills/team/SKILL.md",
        ),
      ).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("avoids partial global installs when a marketplace import hits a later conflict", async () => {
    const context = await createTestContext("cli-scan-marketplace-global-atomic");

    try {
      await runCli(["init"]);
      await runCli(["harness", "set", "--main", "cursor"]);

      await expect(
        runCli([
          "project",
          "scan",
          join(pluginImportFixtureRoot, "marketplace/.cursor-plugin/marketplace.json"),
          "--global",
          "--harness",
          "cursor",
        ]),
      ).rejects.toThrow(/Global install cancelled for release-guardian/);

      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );
      const snapshots = importedSnapshotModel.listImportedSnapshots();

      expect(existsSync(join(context.homeDir, ".cursor/rules/review.mdc"))).toBe(false);
      expect(
        snapshots.flatMap((snapshot) =>
          importedSnapshotModel.listImportedSnapshotInstalls(snapshot.id),
        ),
      ).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("keeps project scan behavior when a project also contains a plugin manifest", async () => {
    const context = await createTestContext("cli-scan-project-over-plugin-root");

    try {
      initGitRepo(context.projectDir);
      writeTextFile(`${context.projectDir}/AGENTS.md`, "# Project instructions");
      writeTextFile(
        `${context.projectDir}/.agents/skills/research/SKILL.md`,
        "---\nname: research\ndescription: Research helper\n---\n# Research\n",
      );
      writeTextFile(
        `${context.projectDir}/.cursor-plugin/plugin.json`,
        JSON.stringify({ name: "embedded-plugin", version: "1.0.0" }),
      );
      writeTextFile(
        `${context.projectDir}/skills/team/SKILL.md`,
        "---\nname: team\ndescription: Team skill\n---\n# Team\n",
      );

      await runCli(["init"]);
      const result = await runCli(["project", "scan", context.projectDir]);

      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );

      expect(result.stdout).toContain("codex");
      expect(result.stdout).toContain("embedded-plugin");
      expect(result.stdout).toContain("Project registered");
      expect(importedSnapshotModel.listImportedSnapshots()).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects global install flags for normal project scans", async () => {
    const context = await createTestContext("cli-scan-project-global-reject");

    try {
      initGitRepo(context.projectDir);
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Claude instructions");

      await runCli(["init"]);

      await expect(
        runCli(["project", "scan", context.projectDir, "--global"]),
      ).rejects.toThrow(/plugin source/i);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects explicit harness targets without global install", async () => {
    const context = await createTestContext("cli-scan-harness-without-global");

    try {
      await runCli(["init"]);

      await expect(
        runCli([
          "project",
          "scan",
          join(pluginImportFixtureRoot, "cursor-team-kit"),
          "--harness",
          "cursor",
        ]),
      ).rejects.toThrow(/--harness without --global is not supported when scanning a plugin source/i);
    } finally {
      await context.cleanup();
    }
  });
});
