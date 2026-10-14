import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { CursorPluginProvider } from "../../src/plugins/providers/cursor.js";

const fixtureHome = join(
  import.meta.dirname,
  "../fixtures/cursor-plugins-home",
);

describe("CursorPluginProvider", () => {
  it("lists cache, local, agent-plugin, and marketplace installs", async () => {
    const provider = new CursorPluginProvider();
    const installs = await provider.list({
      projectRoot: ".",
      homeRoot: fixtureHome,
      harnesstapDir: "/tmp/ht",
    });

    const byRef = Object.fromEntries(installs.map((row) => [row.ref, row]));

    expect(Object.keys(byRef).sort()).toEqual([
      "active-plugin@cursor-public",
      "agent-demo@cursor-public",
      "demo@cursor-public",
      "dormant@cursor-public",
      "homemade@local",
      "only-market@example",
    ]);
    expect(byRef["active-plugin@cursor-public"]).toMatchObject({
      enabled: true,
      scope: "user",
      version: "2.0.0",
    });
    expect(byRef["dormant@cursor-public"]).toMatchObject({
      enabled: true,
      scope: "user",
      version: "0.1.0",
    });
    expect(byRef["homemade@local"]).toMatchObject({
      enabled: true,
      scope: "local",
      version: "0.0.1",
    });
    expect(byRef["only-market@example"]).toMatchObject({
      enabled: true,
      scope: "user",
      version: "9.9.9",
    });
  });

  it("skips git refresh when cache is fresh", async () => {
    const provider = new CursorPluginProvider({
      runCommand: () => ({ stdout: "", stderr: "", exitCode: 0 }),
    });
    const results = await provider.check(
      {
        projectRoot: ".",
        homeRoot: fixtureHome,
        harnesstapDir: "/tmp/ht",
      },
      {
        forceRefresh: false,
        maxAgeHours: 24,
        refreshCache: {
          sources: {
            "cursor:repo:https://github.com/example/demo.git": {
              lastRefreshedAt: new Date().toISOString(),
            },
            "cursor:repo:https://github.com/example/active-plugin.git": {
              lastRefreshedAt: new Date().toISOString(),
            },
            "cursor:repo:https://github.com/example/dormant.git": {
              lastRefreshedAt: new Date().toISOString(),
            },
          },
        },
      },
    );
    const demo = results.find((row) => row.ref === "demo@cursor-public");
    expect(demo?.refreshSkipped).toBe(true);
    expect(demo?.status).toBe("unknown");
  });

  it("fails install when the plugin tree is not on disk", async () => {
    const provider = new CursorPluginProvider();
    const result = await provider.install(
      {
        projectRoot: ".",
        homeRoot: fixtureHome,
        harnesstapDir: "/tmp/ht",
      },
      { ref: "superpowers@superpowers-dev" },
    );

    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/No on-disk plugin tree/i);
  });
});
