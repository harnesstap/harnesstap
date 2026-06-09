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
      harnessdeckDir: "/tmp/hd",
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
        harnessdeckDir: "/tmp/hd",
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
        harnessdeckDir: "/tmp/hd",
      },
      { ref: "new-plugin@demo-market", scope: "project" },
    );

    expect(calls).toEqual([
      ["plugin", "install", "new-plugin@demo-market", "--scope", "project"],
    ]);
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
        harnessdeckDir: "/tmp/hd",
      },
      { ref: "formatter@acme-marketplace", scope: "project" },
    );

    expect(result.status).toBe("already_installed");
    expect(result.install?.version).toBe("1.2.3");
  });
});
