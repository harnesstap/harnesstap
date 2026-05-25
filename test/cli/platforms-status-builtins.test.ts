import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI platforms, status, and built-in presets", () => {
  it("lists platforms and applies built-in presets", async () => {
    const context = await createTestContext("cli-builtins");

    try {
      await runCli(["init"]);

      const platforms = await runCli(["platform", "list"]);
      const templates = await runCli(["preset", "list"]);
      const applied = await runCli([
        "project",
        "apply",
        "nextjs-fullstack",
        "--project",
        context.projectDir,
        "--platform",
        "codex",
      ]);

      expect(platforms.stdout).toContain("claude-code");
      expect(platforms.stdout).toContain("cursor");
      expect(templates.stdout).toContain("nextjs-fullstack");
      // New per-platform verdict format: "codex · wrote N file(s)"
      expect(applied.stdout).toContain("codex");
      expect(applied.stdout).toContain("wrote");
      expect(existsSync(`${context.projectDir}/AGENTS.md`)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("reports project status for tracked presets and snapshots", async () => {
    const context = await createTestContext("cli-status");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-status.git");
      await runCli(["init"]);

      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "tracked" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "tracked-context",
          content: "# Tracked instructions",
        }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      await runCli([
        "project",
        "apply",
        "tracked",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
      ]);

      const status = await runCli(["project", "status", context.projectDir]);
      expect(status.stdout).toContain("Platforms");
      expect(status.stdout).toContain("Applied presets");
      expect(status.stdout).toContain("Snapshots");
    } finally {
      await context.cleanup();
    }
  });
});
