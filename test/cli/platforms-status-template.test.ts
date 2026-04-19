import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI platforms, status, and template", () => {
  it("lists platforms and applies built-in templates", async () => {
    const context = await createTestContext("cli-template");

    try {
      await runCli(["init"]);

      const platforms = await runCli(["platforms"]);
      const templates = await runCli(["template", "list"]);
      const applied = await runCli([
        "template",
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
      expect(applied.stdout).toContain("codex: wrote");
      expect(existsSync(`${context.projectDir}/AGENTS.md`)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("reports project status for tracked presets and snapshots", async () => {
    const context = await createTestContext("cli-status");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/skilldeck-status.git");
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
        "apply",
        "tracked",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
      ]);

      const status = await runCli(["status", context.projectDir]);
      expect(status.stdout).toContain("Platforms:");
      expect(status.stdout).toContain("Applied presets: 1");
      expect(status.stdout).toContain("Snapshots:       1");
    } finally {
      await context.cleanup();
    }
  });
});
