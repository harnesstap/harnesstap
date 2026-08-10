import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { listPluginPlugins } from "../../src/services/plugin-composition.ts";
import { getPlugin } from "../../src/models/plugin-model.ts";

describe("CLI plugin plugin pins", () => {
  it("adds and shows plugin pin on plugin through plugin edit --type plugin", async () => {
    const context = await createTestContext("cli-plugin-plugin");

    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "p1"]);
      await runCli(["plugin", "edit", "p1", "--add", "fmt@acme", "--type", "plugin", "--version", ">=2.0.0 <3.0.0", "--no-interactive"]);
      const show = await runCli(["plugin", "show", "p1"]);
      expect(show.stdout).toContain("fmt@acme");
      expect(show.stdout).toContain(">=2.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("includes plugins in plugin show JSON after plugin edit --type plugin", async () => {
    const context = await createTestContext("cli-plugin-plugin-json");

    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "pj"]);
      await runCli(["plugin", "edit", "pj", "--add", "tools@hub", "--type", "plugin", "--version", "^1.2.3", "--no-interactive"]);
      const show = await runCli([
        "plugin",
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

  it("plugin edit --remove --type plugin drops pin from show", async () => {
    const context = await createTestContext("cli-plugin-plugin-remove");

    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "pr"]);
      await runCli(["plugin", "edit", "pr", "--add", "gone@mp", "--type", "plugin", "--version", "1.0.0", "--no-interactive"]);
      await runCli(["plugin", "edit", "pr", "--remove", "gone@mp", "--type", "plugin", "--no-interactive"]);
      const show = await runCli(["plugin", "show", "pr"]);
      expect(show.stdout).not.toContain("gone@mp");
    } finally {
      await context.cleanup();
    }
  });

  it("allows lazy plugin edit --type plugin without --version", async () => {
    const context = await createTestContext("cli-plugin-plugin-lazy");

    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "pv"]);

      const result = await runCli(["plugin", "edit", "pv", "--add", "tools@hub", "--type", "plugin", "--no-interactive"]);

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("Attached plugin tools@hub");
    } finally {
      await context.cleanup();
    }
  });

  it("persists embed_on_export for plugin edit --type plugin --embed", async () => {
    const context = await createTestContext("cli-plugin-plugin-embed");

    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "embed-plugin"]);

      const result = await runCli(["plugin", "edit", "embed-plugin", "--add", "tools@hub", "--type", "plugin", "--version", "^1.2.3", "--embed", "--no-interactive"]);

      expect(result.exitCode ?? 0).toBe(0);
      const plugin = getPlugin("embed-plugin");
      if (!plugin) throw new Error("Expected plugin to exist");
      expect(listPluginPlugins(plugin.id)).toEqual(
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
