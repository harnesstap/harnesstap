import { describe, expect, it } from "bun:test";
import { GoosePluginProvider } from "../../src/plugins/providers/goose.ts";
import type { CommandResult } from "../../src/plugins/run-command.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { join } from "node:path";

describe("GoosePluginProvider", () => {
  it("lists installed plugins from ~/.agents/plugins", async () => {
    const homeDir = createTempDir("goose-plugins-home");

    try {
      writeTextFile(
        join(homeDir, ".agents", "plugins", "my-plugin", "plugin.json"),
        JSON.stringify({ name: "my-plugin", version: "1.2.3" }),
      );

      const provider = new GoosePluginProvider();
      const installs = await provider.list({
        homeRoot: homeDir,
        projectRoot: ".",
        harnessdeckDir: join(homeDir, ".harnessdeck"),
      });

      expect(installs).toHaveLength(1);
      expect(installs[0]?.name).toBe("my-plugin");
      expect(installs[0]?.version).toBe("1.2.3");
    } finally {
      cleanupDir(homeDir);
    }
  });

  it("installs plugins via goose plugin install", async () => {
    const calls: string[][] = [];
    const provider = new GoosePluginProvider({
      runCommand: (_binary, args): CommandResult => {
        calls.push(args);
        return { exitCode: 0, stdout: "installed", stderr: "" };
      },
    });

    const homeDir = createTempDir("goose-install-home");
    try {
      const result = await provider.install(
        {
          homeRoot: homeDir,
          projectRoot: ".",
          harnessdeckDir: join(homeDir, ".harnessdeck"),
        },
        { ref: "https://github.com/example/plugin.git" },
      );

      expect(calls).toEqual([
        ["plugin", "install", "https://github.com/example/plugin.git"],
      ]);
      expect(result.status).toBe("failed");
      expect(result.message).toContain("~/.agents/plugins/");
    } finally {
      cleanupDir(homeDir);
    }
  });
});
