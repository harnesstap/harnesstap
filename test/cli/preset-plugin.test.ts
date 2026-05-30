import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI preset plugin pins", () => {
  it("adds and shows plugin pin on preset through preset attach --type plugin", async () => {
    const context = await createTestContext("cli-preset-plugin");

    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "p1"]);
      await runCli([
        "preset",
        "attach",
        "p1",
        "fmt@acme",
        "--type",
        "plugin",
        "--version",
        ">=2.0.0 <3.0.0",
      ]);
      const show = await runCli(["preset", "show", "p1"]);
      expect(show.stdout).toContain("fmt@acme");
      expect(show.stdout).toContain(">=2.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("includes plugins in preset show JSON after preset attach --type plugin", async () => {
    const context = await createTestContext("cli-preset-plugin-json");

    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "pj"]);
      await runCli([
        "preset",
        "attach",
        "pj",
        "tools@hub",
        "--type",
        "plugin",
        "--version",
        "^1.2.3",
      ]);
      const show = await runCli([
        "preset",
        "show",
        "pj",
        "--format",
        "json",
      ]);
      const data = JSON.parse(show.stdout.trim()) as {
        plugins: Array<{ ref: string; version_constraint: string }>;
      };
      expect(data.plugins).toHaveLength(1);
      expect(data.plugins[0]?.ref).toBe("tools@hub");
      expect(data.plugins[0]?.version_constraint).toBe("^1.2.3");
    } finally {
      await context.cleanup();
    }
  });

  it("preset detach --type plugin drops pin from show", async () => {
    const context = await createTestContext("cli-preset-plugin-remove");

    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "pr"]);
      await runCli([
        "preset",
        "attach",
        "pr",
        "gone@mp",
        "--type",
        "plugin",
        "--version",
        "1.0.0",
      ]);
      await runCli(["preset", "detach", "pr", "gone@mp", "--type", "plugin"]);
      const show = await runCli(["preset", "show", "pr"]);
      expect(show.stdout).not.toContain("gone@mp");
    } finally {
      await context.cleanup();
    }
  });

  it("requires --version for preset attach --type plugin", async () => {
    const context = await createTestContext("cli-preset-plugin-version-required");

    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "pv"]);

      const result = await runCli([
        "preset",
        "attach",
        "pv",
        "tools@hub",
        "--type",
        "plugin",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--version is required for --type plugin");
    } finally {
      await context.cleanup();
    }
  });

  it("persists embed_on_export for preset attach --type plugin --embed", async () => {
    const context = await createTestContext("cli-preset-plugin-embed");

    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "embed-preset"]);
      const pluginModel = await import("../../src/models/plugin.ts");
      const presetModel = await import("../../src/models/preset.ts");

      const result = await runCli([
        "preset",
        "attach",
        "embed-preset",
        "tools@hub",
        "--type",
        "plugin",
        "--version",
        "^1.2.3",
        "--embed",
      ]);

      expect(result.exitCode ?? 0).toBe(0);
      const preset = presetModel.getPreset("embed-preset");
      if (!preset) throw new Error("Expected preset to exist");
      expect(pluginModel.listPresetPlugins(preset.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ref: "tools@hub",
            version_constraint: "^1.2.3",
            embed_on_export: true,
          }),
        ]),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("legacy add-plugin and remove-plugin commands emit deprecation warnings and forward", async () => {
    const context = await createTestContext("cli-preset-plugin-legacy-forward");

    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "legacy-preset"]);
      const pluginModel = await import("../../src/models/plugin.ts");
      const presetModel = await import("../../src/models/preset.ts");

      const addResult = await runCli([
        "preset",
        "add-plugin",
        "legacy-preset",
        "tools@hub",
        "--version",
        "^1.2.3",
      ]);
      expect(addResult.stdout).toContain("`preset add-plugin` is deprecated; use `preset attach ... --type plugin` instead.");

      const preset = presetModel.getPreset("legacy-preset");
      if (!preset) throw new Error("Expected preset to exist");
      expect(pluginModel.listPresetPlugins(preset.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ref: "tools@hub", version_constraint: "^1.2.3" }),
        ]),
      );

      const removeResult = await runCli([
        "preset",
        "remove-plugin",
        "legacy-preset",
        "tools@hub",
      ]);
      expect(removeResult.stdout).toContain("`preset remove-plugin` is deprecated; use `preset detach ... --type plugin` instead.");
      expect(pluginModel.listPresetPlugins(preset.id)).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("legacy add-plugin forwards validation failures with a deprecation warning", async () => {
    const context = await createTestContext("cli-preset-plugin-legacy-forward-failure");

    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "legacy-preset"]);

      const result = await runCli([
        "preset",
        "add-plugin",
        "legacy-preset",
        "tools@hub",
        "--version",
        "not-semver",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("`preset add-plugin` is deprecated; use `preset attach ... --type plugin` instead.");
      expect(result.stderr).toMatch(/invalid version constraint/i);
    } finally {
      await context.cleanup();
    }
  });
});
