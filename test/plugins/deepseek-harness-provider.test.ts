import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { DeepSeekHarnessPluginProvider } from "../../src/plugins/providers/deepseek-harness.ts";
import type { CommandResult } from "../../src/plugins/run-command.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

describe("DeepSeekHarnessPluginProvider", () => {
  it("lists dsh.bundle packages from the web profile", async () => {
    const homeDir = createTempDir("dsh-plugins-home");
    try {
      writeTextFile(
        join(homeDir, ".dsh/profiles/web/package.json"),
        JSON.stringify({
          name: "dsh-profile-web",
          dependencies: { "turtle-ui": "1.2.3" },
        }),
      );
      writeTextFile(
        join(homeDir, ".dsh/profiles/web/node_modules/turtle-ui/package.json"),
        JSON.stringify({
          name: "turtle-ui",
          version: "1.2.3",
          description: "Turtle UI",
          dsh: { bundle: { patch: "./cordis.patch.yml" } },
        }),
      );

      const installs = await new DeepSeekHarnessPluginProvider().list({
        homeRoot: homeDir,
        projectRoot: ".",
        harnesstapDir: join(homeDir, ".harnesstap"),
      });
      expect(installs).toEqual([
        expect.objectContaining({
          ref: "turtle-ui",
          name: "turtle-ui",
          version: "1.2.3",
          platformId: "deepseek-harness",
          enabled: true,
        }),
      ]);
    } finally {
      cleanupDir(homeDir);
    }
  });

  it("installs via dsh plugin --profile web add", async () => {
    const calls: Array<{ binary: string; args: string[] }> = [];
    const provider = new DeepSeekHarnessPluginProvider({
      runCommand: (binary, args): CommandResult => {
        calls.push({ binary, args });
        return { exitCode: 0, stdout: "added", stderr: "" };
      },
    });
    const result = await provider.install(
      { homeRoot: "/tmp", projectRoot: ".", harnesstapDir: "/tmp/.harnesstap" },
      { ref: "github:deepseek-harness/turtle-ui" },
    );
    expect(calls).toEqual([
      {
        binary: "dsh",
        args: ["plugin", "--profile", "web", "add", "github:deepseek-harness/turtle-ui"],
      },
    ]);
    expect(result.status).toBe("installed");
  });

  it("fails when dsh is missing", async () => {
    const provider = new DeepSeekHarnessPluginProvider({
      runCommand: (): CommandResult => ({
        exitCode: 127,
        stdout: "",
        stderr: "dsh: command not found",
      }),
    });
    const result = await provider.install(
      { homeRoot: "/tmp", projectRoot: ".", harnesstapDir: "/tmp/.harnesstap" },
      { ref: "turtle-ui" },
    );
    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/DeepSeek Harness/i);
  });
});
