import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { ClaudeCodePluginProvider } from "../../src/plugins/providers/claude-code.js";

const fixtureHome = join(
  import.meta.dirname,
  "../fixtures/claude-plugins-home",
);

describe("ClaudeCodePluginProvider", () => {
  it("lists installed plugins from installed_plugins.json", async () => {
    const provider = new ClaudeCodePluginProvider();
    const installs = await provider.list({
      projectRoot: ".",
      homeRoot: fixtureHome,
      harnesstapDir: "/tmp/hd",
    });
    const demo = installs.find((i) => i.ref === "demo@demo-market");
    expect(demo).toBeDefined();
    expect(demo?.version).toBe("1.0.0");
  });

  it("marks plugin outdated when marketplace sha differs", async () => {
    const provider = new ClaudeCodePluginProvider({
      runCommand: () => ({ stdout: "", stderr: "", exitCode: 0 }),
    });
    const results = await provider.check(
      {
        projectRoot: ".",
        homeRoot: fixtureHome,
        harnesstapDir: "/tmp/hd",
      },
      {
        forceRefresh: false,
        maxAgeHours: 24,
        refreshCache: { sources: {} },
      },
    );
    const demo = results.find((r) => r.ref === "demo@demo-market");
    expect(demo?.status).toBe("outdated");
    expect(demo?.latestVersion).toBe("2.0.0");
  });

  it("installs plugins via claude plugin install", async () => {
    const calls: string[][] = [];
    const provider = new ClaudeCodePluginProvider({
      runCommand: (_command, args) => {
        calls.push(args);
        return { stdout: "Installed", stderr: "", exitCode: 0 };
      },
    });

    const result = await provider.install(
      {
        projectRoot: "/tmp/project",
        homeRoot: fixtureHome,
        harnesstapDir: "/tmp/hd",
      },
      { ref: "new-plugin@demo-market", scope: "project" },
    );

    expect(calls.some((args) => args[1] === "install" && args[2] === "new-plugin@demo-market")).toBe(
      true,
    );
    expect(result.status).toBe("failed");
    expect(result.message).toContain("installed_plugins.json");
  });

  it("installs catalog pins via resolved marketplace refs", async () => {
    const calls: string[][] = [];
    const provider = new ClaudeCodePluginProvider({
      runCommand: (_command, args) => {
        calls.push(args);
        if (args[0] === "marketplace") {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (args[1] === "install" && args[2] === "context7@claude-plugins-official") {
          return { stdout: "Installed", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "not found", exitCode: 1 };
      },
    });

    const result = await provider.install(
      {
        projectRoot: "/tmp/project",
        homeRoot: fixtureHome,
        harnesstapDir: "/tmp/hd",
      },
      { ref: "context7@anthropics", scope: "project" },
    );

    const installCalls = calls.filter((args) => args[0] === "plugin" && args[1] === "install");
    expect(installCalls[0]?.[2]).toBe("context7@claude-plugins-official");
    expect(result.status).toBe("failed");
    expect(result.message).toContain("installed_plugins.json");
  });

  it("reports already installed plugins for matching scope", async () => {
    const provider = new ClaudeCodePluginProvider({
      runCommand: () => {
        throw new Error("should not invoke claude when already installed");
      },
    });

    const result = await provider.install(
      {
        projectRoot: "/tmp/project",
        homeRoot: fixtureHome,
        harnesstapDir: "/tmp/hd",
      },
      { ref: "formatter@acme-marketplace", scope: "project" },
    );

    expect(result.status).toBe("already_installed");
    expect(result.install?.version).toBe("1.2.3");
  });
});
