import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { CursorPluginProvider } from "../../src/plugins/providers/cursor.js";

const fixtureHome = join(
  import.meta.dirname,
  "../fixtures/cursor-plugins-home",
);

describe("CursorPluginProvider", () => {
  it("lists plugins from cursor cache", async () => {
    const provider = new CursorPluginProvider();
    const installs = await provider.list({
      projectRoot: ".",
      homeRoot: fixtureHome,
      harnesstapDir: "/tmp/hd",
    });
    expect(installs).toHaveLength(1);
    expect(installs[0]?.ref).toBe("demo@cursor-public");
  });

  it("skips git refresh when cache is fresh", async () => {
    const provider = new CursorPluginProvider({
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
        refreshCache: {
          sources: {
            "cursor:repo:https://github.com/example/demo.git": {
              lastRefreshedAt: new Date().toISOString(),
            },
          },
        },
      },
    );
    expect(results[0]?.refreshSkipped).toBe(true);
    expect(results[0]?.status).toBe("unknown");
  });
});
