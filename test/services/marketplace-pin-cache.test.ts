import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import { refreshMarketplaceCatalog } from "../../src/services/marketplace-catalog.ts";
import { installMarketplacePinIntoCache } from "../../src/services/marketplace-pin-cache.ts";
import { hostPluginPackageDir } from "../../src/services/package-cache/paths.ts";

function initPluginMarketplace(): string {
  const repo = mkdtempSync(join(tmpdir(), "ht-pin-mkt-"));
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(repo, "plugins", "alpha", ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "local-market",
      plugins: [{ name: "alpha", version: "1.0.0", source: "./plugins/alpha" }],
    }),
  );
  writeFileSync(
    join(repo, "plugins", "alpha", ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "alpha", version: "1.0.0", description: "Alpha plugin" }),
  );
  writeFileSync(join(repo, "plugins", "alpha", "plugin.json"), JSON.stringify({
    name: "alpha",
    version: "1.0.0",
  }));
  spawnSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: repo, stdio: "ignore" });
  spawnSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"],
    { cwd: repo, stdio: "ignore" },
  );
  spawnSync("git", ["branch", "-M", "main"], { cwd: repo, stdio: "ignore" });
  return repo;
}

describe("installMarketplacePinIntoCache", () => {
  it("copies a local marketplace plugin into the package cache", async () => {
    const context = await createTestContext("pin-cache-install");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      const repo = initPluginMarketplace();
      addMarketplace(harnesstapDir, {
        name: "local-market",
        url: repo,
        platforms: ["claude-code"],
      });
      const refresh = refreshMarketplaceCatalog(harnesstapDir, {
        name: "local-market",
        force: true,
      });
      expect(refresh.ok).toBe(true);

      const result = installMarketplacePinIntoCache({
        originRef: "alpha@local-market",
        versionConstraint: "latest",
        homeRoot: context.homeDir,
        harnesstapDir,
      });
      expect(result.version).toBe("1.0.0");
      expect(existsSync(join(result.install_path, "plugin.json"))).toBe(true);
      expect(
        existsSync(hostPluginPackageDir(harnesstapDir, "local-market", "alpha", "1.0.0")),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
