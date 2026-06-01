import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI layer plugin pins", () => {
  it("adds and shows plugin pin on layer through layer attach --type plugin", async () => {
    const context = await createTestContext("cli-layer-plugin");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "p1"]);
      await runCli([
        "layer",
        "attach",
        "p1",
        "fmt@acme",
        "--type",
        "plugin",
        "--version",
        ">=2.0.0 <3.0.0",
      ]);
      const show = await runCli(["layer", "show", "p1"]);
      expect(show.stdout).toContain("fmt@acme");
      expect(show.stdout).toContain(">=2.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("includes plugins in layer show JSON after layer attach --type plugin", async () => {
    const context = await createTestContext("cli-layer-plugin-json");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "pj"]);
      await runCli([
        "layer",
        "attach",
        "pj",
        "tools@hub",
        "--type",
        "plugin",
        "--version",
        "^1.2.3",
      ]);
      const show = await runCli([
        "layer",
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

  it("layer detach --type plugin drops pin from show", async () => {
    const context = await createTestContext("cli-layer-plugin-remove");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "pr"]);
      await runCli([
        "layer",
        "attach",
        "pr",
        "gone@mp",
        "--type",
        "plugin",
        "--version",
        "1.0.0",
      ]);
      await runCli(["layer", "detach", "pr", "gone@mp", "--type", "plugin"]);
      const show = await runCli(["layer", "show", "pr"]);
      expect(show.stdout).not.toContain("gone@mp");
    } finally {
      await context.cleanup();
    }
  });

  it("requires --version for layer attach --type plugin", async () => {
    const context = await createTestContext("cli-layer-plugin-version-required");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "pv"]);

      const result = await runCli([
        "layer",
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

  it("persists embed_on_export for layer attach --type plugin --embed", async () => {
    const context = await createTestContext("cli-layer-plugin-embed");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "embed-layer"]);
      const pluginModel = await import("../../src/models/plugin.ts");
      const layerModel = await import("../../src/models/layer.ts");

      const result = await runCli([
        "layer",
        "attach",
        "embed-layer",
        "tools@hub",
        "--type",
        "plugin",
        "--version",
        "^1.2.3",
        "--embed",
      ]);

      expect(result.exitCode ?? 0).toBe(0);
      const layer = layerModel.getLayer("embed-layer");
      if (!layer) throw new Error("Expected layer to exist");
      expect(pluginModel.listLayerPlugins(layer.id)).toEqual(
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

});
