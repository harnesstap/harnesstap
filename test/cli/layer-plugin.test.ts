import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { listLayerPlugins } from "../../src/services/layer-composition.ts";
import { getLayer } from "../../src/models/layer-model.ts";

describe("CLI layer plugin pins", () => {
  it("adds and shows plugin pin on layer through layer edit --type plugin", async () => {
    const context = await createTestContext("cli-layer-plugin");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "p1"]);
      await runCli(["layer", "edit", "p1", "--add", "fmt@acme", "--type", "plugin", "--version", ">=2.0.0 <3.0.0", "--no-interactive"]);
      const show = await runCli(["layer", "show", "p1"]);
      expect(show.stdout).toContain("fmt@acme");
      expect(show.stdout).toContain(">=2.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("includes plugins in layer show JSON after layer edit --type plugin", async () => {
    const context = await createTestContext("cli-layer-plugin-json");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "pj"]);
      await runCli(["layer", "edit", "pj", "--add", "tools@hub", "--type", "plugin", "--version", "^1.2.3", "--no-interactive"]);
      const show = await runCli([
        "layer",
        "show",
        "pj",
        "--format",
        "json",
      ]);
      const data = JSON.parse(show.stdout.trim()) as {
        plugin_pins: Array<{ ref: string; version_constraint: string }>;
      };
      expect(data.plugin_pins).toHaveLength(1);
      expect(data.plugin_pins[0]?.ref).toBe("tools@hub");
      expect(data.plugin_pins[0]?.version_constraint).toBe("^1.2.3");
    } finally {
      await context.cleanup();
    }
  });

  it("layer edit --remove --type plugin drops pin from show", async () => {
    const context = await createTestContext("cli-layer-plugin-remove");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "pr"]);
      await runCli(["layer", "edit", "pr", "--add", "gone@mp", "--type", "plugin", "--version", "1.0.0", "--no-interactive"]);
      await runCli(["layer", "edit", "pr", "--remove", "gone@mp", "--type", "plugin", "--no-interactive"]);
      const show = await runCli(["layer", "show", "pr"]);
      expect(show.stdout).not.toContain("gone@mp");
    } finally {
      await context.cleanup();
    }
  });

  it("allows lazy layer edit --type plugin without --version", async () => {
    const context = await createTestContext("cli-layer-plugin-lazy");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "pv"]);

      const result = await runCli(["layer", "edit", "pv", "--add", "tools@hub", "--type", "plugin", "--no-interactive"]);

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("Attached plugin tools@hub");
    } finally {
      await context.cleanup();
    }
  });

  it("persists embed_on_export for layer edit --type plugin --embed", async () => {
    const context = await createTestContext("cli-layer-plugin-embed");

    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "embed-layer"]);

      const result = await runCli(["layer", "edit", "embed-layer", "--add", "tools@hub", "--type", "plugin", "--version", "^1.2.3", "--embed", "--no-interactive"]);

      expect(result.exitCode ?? 0).toBe(0);
      const layer = getLayer("embed-layer");
      if (!layer) throw new Error("Expected layer to exist");
      expect(listLayerPlugins(layer.id)).toEqual(
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
