import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI output format", () => {
  it("emits JSON for preset, status, history, platform, init, and apply dry-run commands", async () => {
    const context = await createTestContext("cli-output-format");
    try {
      await runCli(["init"]);
      const platforms = await runCli(["platform", "list", "--format", "json"]);
      expect(JSON.parse(platforms.stdout)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "claude-code" })]),
      );

      const initResult = await runCli(["init", "--format", "json"]);
      expect(JSON.parse(initResult.stdout)).toEqual(
        expect.objectContaining({
          database_path: expect.any(String),
          built_in_presets: expect.anything(),
        }),
      );

      const presetList = await runCli(["preset", "list", "--format", "json"]);
      expect(Array.isArray(JSON.parse(presetList.stdout))).toBe(true);

      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-output.git");
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "dry-run-preset" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "dry-run",
          content: "# Dry run",
        }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const dryRun = await runCli([
        "project",
        "apply",
        "dry-run-preset",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--dry-run",
        "--format",
        "json",
      ]);
      expect(JSON.parse(dryRun.stdout)).toEqual(
        expect.objectContaining({
          preset: "dry-run-preset",
          project_root: expect.any(String),
          platforms: expect.any(Array),
        }),
      );

      await runCli([
        "project",
        "apply",
        "dry-run-preset",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
      ]);

      const status = await runCli([
        "project",
        "status",
        context.projectDir,
        "--format",
        "json",
      ]);
      expect(JSON.parse(status.stdout)).toEqual(
        expect.objectContaining({
          project_root: expect.any(String),
          git_origin: expect.any(String),
          platforms: expect.any(Array),
        }),
      );

      const history = await runCli([
        "project",
        "history",
        "--project",
        context.projectDir,
        "--format",
        "json",
      ]);
      const historyPayload = JSON.parse(history.stdout);
      expect(Array.isArray(historyPayload)).toBe(true);
      expect(historyPayload[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          label: expect.any(String),
        }),
      );
    } finally {
      await context.cleanup();
    }
  });
});
