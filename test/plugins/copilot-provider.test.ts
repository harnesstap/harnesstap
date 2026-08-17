import { describe, expect, it } from "bun:test";
import { CopilotPluginProvider } from "../../src/plugins/providers/copilot-cli.ts";
import type { CommandResult } from "../../src/plugins/run-command.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { join } from "node:path";

function writeInstalledPlugin(
  homeDir: string,
  marketplace: string,
  name: string,
  version = "1.0.0",
): void {
  writeTextFile(
    join(
      homeDir,
      ".copilot/installed-plugins",
      marketplace,
      name,
      ".claude-plugin/plugin.json",
    ),
    JSON.stringify({ name, version, description: `${name} plugin` }),
  );
}

describe("CopilotPluginProvider", () => {
  it("lists installed plugins from ~/.copilot/installed-plugins", async () => {
    const homeDir = createTempDir("copilot-provider-list");

    try {
      writeInstalledPlugin(homeDir, "claude-code-skills", "business-growth-skills");
      writeTextFile(
        join(homeDir, ".copilot/settings.json"),
        JSON.stringify({
          enabledPlugins: {
            "business-growth-skills@claude-code-skills": true,
          },
        }),
      );

      const provider = new CopilotPluginProvider();
      const installs = await provider.list({
        homeRoot: homeDir,
        projectRoot: ".",
        harnesstapDir: join(homeDir, ".harnesstap"),
      });

      expect(installs).toHaveLength(1);
      expect(installs[0]).toMatchObject({
        ref: "business-growth-skills@claude-code-skills",
        platformId: "copilot-cli",
        name: "business-growth-skills",
        version: "1.0.0",
        enabled: true,
        scope: "user",
      });
    } finally {
      cleanupDir(homeDir);
    }
  });

  it("installs plugins via copilot plugin install", async () => {
    const homeDir = createTempDir("copilot-provider-install");
    const calls: string[][] = [];

    try {
      const provider = new CopilotPluginProvider({
        runCommand: (_binary, args): CommandResult => {
          calls.push(args);
          if (args[1] === "install") {
            writeInstalledPlugin(homeDir, "claude-code-skills", "business-growth-skills");
          }
          return { exitCode: 0, stdout: "Installed", stderr: "" };
        },
      });

      const result = await provider.install(
        {
          homeRoot: homeDir,
          projectRoot: ".",
          harnesstapDir: join(homeDir, ".harnesstap"),
        },
        { ref: "business-growth-skills@claude-code-skills" },
      );

      expect(calls).toEqual([
        ["plugin", "marketplace", "update", "claude-code-skills"],
        ["plugin", "install", "business-growth-skills@claude-code-skills"],
      ]);
      expect(result.status).toBe("installed");
      expect(result.install?.ref).toBe("business-growth-skills@claude-code-skills");
    } finally {
      cleanupDir(homeDir);
    }
  });

  it("reports already installed plugins without invoking copilot", async () => {
    const homeDir = createTempDir("copilot-provider-already");

    try {
      writeInstalledPlugin(homeDir, "claude-code-skills", "business-growth-skills");
      const provider = new CopilotPluginProvider({
        runCommand: () => {
          throw new Error("should not invoke copilot when already installed");
        },
      });

      const result = await provider.install(
        {
          homeRoot: homeDir,
          projectRoot: ".",
          harnesstapDir: join(homeDir, ".harnesstap"),
        },
        { ref: "business-growth-skills@claude-code-skills" },
      );

      expect(result.status).toBe("already_installed");
      expect(result.install?.version).toBe("1.0.0");
    } finally {
      cleanupDir(homeDir);
    }
  });

  it("updates plugins via copilot plugin update", async () => {
    const homeDir = createTempDir("copilot-provider-update");
    const calls: string[][] = [];

    try {
      writeInstalledPlugin(homeDir, "claude-code-skills", "business-growth-skills", "1.0.0");
      const provider = new CopilotPluginProvider({
        runCommand: (_binary, args): CommandResult => {
          calls.push(args);
          writeInstalledPlugin(homeDir, "claude-code-skills", "business-growth-skills", "1.1.0");
          return { exitCode: 0, stdout: "Updated", stderr: "" };
        },
      });

      const results = await provider.update(
        {
          homeRoot: homeDir,
          projectRoot: ".",
          harnesstapDir: join(homeDir, ".harnesstap"),
        },
        { ref: "business-growth-skills@claude-code-skills", yes: true },
      );

      expect(calls).toEqual([
        ["plugin", "update", "business-growth-skills@claude-code-skills"],
      ]);
      expect(results[0]).toMatchObject({
        status: "updated",
        previousVersion: "1.0.0",
        newVersion: "1.1.0",
      });
    } finally {
      cleanupDir(homeDir);
    }
  });
});
