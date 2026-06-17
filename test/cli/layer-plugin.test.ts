import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI layer plugin pins", () => {
  it("adds and shows plugin pin on layer through layer combine --type plugin_pin", async () => {
    const context = await createTestContext("cli-layer-plugin");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "p1"]);
      await runCli([
        "layer",
        "combine",
        "p1",
        "fmt@acme",
        "--type",
        "plugin_pin",
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

  it("includes plugins in layer show JSON after layer combine --type plugin_pin", async () => {
    const context = await createTestContext("cli-layer-plugin-json");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "pj"]);
      await runCli([
        "layer",
        "combine",
        "pj",
        "tools@hub",
        "--type",
        "plugin_pin",
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
      expect(data.plugin_pins).toHaveLength(1);
      expect(data.plugin_pins[0]?.ref).toBe("tools@hub");
      expect(data.plugin_pins[0]?.version_constraint).toBe("^1.2.3");
    } finally {
      await context.cleanup();
    }
  });

  it("layer uncombine --type plugin_pin drops pin from show", async () => {
    const context = await createTestContext("cli-layer-plugin-remove");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "pr"]);
      await runCli([
        "layer",
        "combine",
        "pr",
        "gone@mp",
        "--type",
        "plugin_pin",
        "--version",
        "1.0.0",
      ]);
      await runCli(["layer", "uncombine", "pr", "gone@mp", "--type", "plugin_pin"]);
      const show = await runCli(["layer", "show", "pr"]);
      expect(show.stdout).not.toContain("gone@mp");
    } finally {
      await context.cleanup();
    }
  });

  it("allows lazy layer combine --type plugin_pin without --version", async () => {
    const context = await createTestContext("cli-layer-plugin-lazy");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "pv"]);

      const result = await runCli([
        "layer",
        "combine",
        "pv",
        "tools@hub",
        "--type",
        "plugin_pin",
      ]);

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("Attached plugin pin tools@hub");
    } finally {
      await context.cleanup();
    }
  });

  it("persists embed_on_export for layer combine --type plugin_pin --embed", async () => {
    const context = await createTestContext("cli-layer-plugin-embed");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "embed-layer"]);
      const pluginPins = await import("../../src/services/layer-composition.ts");
      const layerModel = await import("../../src/models/layer-model.ts");

      const result = await runCli([
        "layer",
        "combine",
        "embed-layer",
        "tools@hub",
        "--type",
        "plugin_pin",
        "--version",
        "^1.2.3",
        "--embed",
      ]);

      expect(result.exitCode ?? 0).toBe(0);
      const layer = layerModel.getLayer("embed-layer");
      if (!layer) throw new Error("Expected layer to exist");
      expect(pluginPins.listLayerPlugins(layer.id)).toEqual(
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
