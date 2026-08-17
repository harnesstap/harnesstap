import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { CursorPluginProvider } from "../../src/plugins/providers/cursor.js";

const fixtureHome = join(
  import.meta.dirname,
  "../fixtures/cursor-plugins-home",
);

describe("CursorPluginProvider", () => {
  it("lists cache, local, agent-plugin, and marketplace installs with enablement", async () => {
    const provider = new CursorPluginProvider({
      // Fixture homes do not read the real Cursor recently-used store.
      collectEnablementSignals: () => ({
        pluginNames: new Set(["active-plugin"]),
      }),
    });
    const installs = await provider.list({
      projectRoot: ".",
      homeRoot: fixtureHome,
      harnesstapDir: "/tmp/ht",
    });

    const byRef = Object.fromEntries(installs.map((row) => [row.ref, row]));

    expect(byRef["active-plugin@cursor-public"]).toMatchObject({
      enabled: true,
      scope: "user",
      version: "2.0.0",
    });
    expect(byRef["dormant@cursor-public"]).toMatchObject({
      enabled: false,
      scope: "user",
    });
    expect(byRef["demo@cursor-public"]).toMatchObject({
      enabled: false,
      scope: "user",
    });
    expect(byRef["agent-demo@cursor-public"]).toMatchObject({
      enabled: false,
      scope: "user",
      version: "1.2.3",
    });
    expect(byRef["homemade@local"]).toMatchObject({
      enabled: true,
      scope: "local",
      version: "0.0.1",
    });
    expect(byRef["only-market@example"]).toMatchObject({
      enabled: false,
      scope: "user",
      version: "9.9.9",
    });
  });

  it("treats recently-used skill paths as enablement signals", async () => {
    const provider = new CursorPluginProvider({
      collectEnablementSignals: () => ({
        pluginNames: new Set(["dormant"]),
      }),
    });
    const installs = await provider.list({
      projectRoot: ".",
      homeRoot: fixtureHome,
      harnesstapDir: "/tmp/ht",
    });
    expect(installs.find((row) => row.ref === "dormant@cursor-public")?.enabled).toBe(
      true,
    );
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

  it("does not install plugins; Cursor has no agent plugin install command", async () => {
    const provider = new CursorPluginProvider();
    const result = await provider.install(
      {
        projectRoot: ".",
        homeRoot: fixtureHome,
        harnesstapDir: "/tmp/ht",
      },
      { ref: "superpowers@superpowers-dev" },
    );

    expect(result.status).toBe("unsupported");
    expect(result.message).toMatch(/agent plugin marketplace/i);
    expect(result.message).toMatch(/IDE|Customize|\/plugin/i);
  });
});
