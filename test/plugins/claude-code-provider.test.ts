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
});
