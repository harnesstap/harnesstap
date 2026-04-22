import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { writeTextFile } from "../helpers/fs.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI help and command organization", () => {
  it("shows grouped commands in help and hides legacy top-level verbs", async () => {
    const help = await runCli(["-h"]);
    const projectHelp = await runCli(["project", "-h"]);
    const presetHelp = await runCli(["preset", "-h"]);

    expect(help.stdout).toContain("project");
    expect(help.stdout).toContain("preset");
    expect(help.stdout).toContain("resource");
    expect(help.stdout).toContain("platform");
    expect(help.stdout).not.toContain("help [command]");
    expect(help.stdout).not.toContain("apply [options] <preset>");
    expect(help.stdout).not.toContain("history [options]");
    expect(help.stdout).not.toContain("revert [snapshot-id]");
    expect(help.stdout).not.toContain("export [options] <preset>");
    expect(help.stdout).not.toContain("import <file>");
    expect(help.stdout).not.toContain("\n  platforms");
    expect(help.stdout).not.toContain("status [path]");
    expect(help.stdout).not.toContain("scan [options] [path]");
    expect(projectHelp.stdout).not.toContain("help [command]");
    expect(presetHelp.stdout).not.toContain("help [command]");
  });

  it("keeps deprecated aliases working while steering users to grouped commands", async () => {
    const context = await createTestContext("cli-aliases");

    try {
      initGitRepo(context.projectDir);
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Claude instructions");
      writeTextFile(
        `${context.projectDir}/.claude/skills/research/SKILL.md`,
        "---\nname: research\ndescription: Research helper\n---\n# Research\n",
      );

      await runCli(["init"]);

      const scanResult = await runCli(["scan", context.projectDir]);
      expect(scanResult.stdout).toContain("deprecated");
      expect(scanResult.stdout).toContain("project scan");
      expect(scanResult.stdout).toContain("Imported");

      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "bundle-preset" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "shared", content: "# Shared" }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const bundlePath = `${context.projectDir}/bundle.json`;
      const exportResult = await runCli([
        "export",
        "bundle-preset",
        "--file",
        bundlePath,
      ]);
      expect(exportResult.stdout).toContain("deprecated");
      expect(exportResult.stdout).toContain("preset export");
      expect(exportResult.stdout).toContain("Exported to");
      expect(existsSync(bundlePath)).toBe(true);

      const applyResult = await runCli([
        "apply",
        "bundle-preset",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--dry-run",
      ]);
      expect(applyResult.stdout).toContain("deprecated");
      expect(applyResult.stdout).toContain("project apply");
      expect(applyResult.stdout).toContain("SKILL.md");
    } finally {
      await context.cleanup();
    }
  });
});
