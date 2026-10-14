import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { readMarketplacePluginSource } from "../../src/services/host-plugin-source.ts";
import { readMarketplaceManifest } from "../../src/services/marketplace-catalog.ts";
import { clearMarketplaceManifestCache } from "../../src/services/marketplace-manifest-cache.ts";
import { cleanupDir, createTempDir } from "../helpers/fs.ts";

const alpha = '{"name":"mkt","plugins":[{"name":"demo","source":"plugins/alpha"}]}\n';
const bravo = '{"name":"mkt","plugins":[{"name":"demo","source":"plugins/bravo"}]}\n';

describe("marketplace manifest cache", () => {
  const dirs: string[] = [];
  afterEach(() => {
    clearMarketplaceManifestCache();
    for (const dir of dirs.splice(0)) cleanupDir(dir);
  });

  it("reuses a manifest until the file changes and returns a clone", () => {
    const root = createTempDir("ht-mkt-manifest");
    dirs.push(root);
    const manifest = join(root, ".claude-plugin", "marketplace.json");
    mkdirSync(join(manifest, ".."), { recursive: true });
    writeFileSync(manifest, alpha);
    const frozen = new Date("2020-06-01T00:00:00.000Z");
    utimesSync(manifest, frozen, frozen);

    const first = readMarketplaceManifest(root) as { name: string };
    expect(first.name).toBe("mkt");
    first.name = "mutated";
    const second = readMarketplaceManifest(root) as { name: string };
    expect(second.name).toBe("mkt");

    writeFileSync(manifest, bravo);
    utimesSync(manifest, frozen, frozen);
    const cached = readMarketplaceManifest(root) as { plugins: Array<{ source: string }> };
    expect(cached.plugins[0]?.source).toBe("plugins/alpha");

    clearMarketplaceManifestCache();
    const fresh = readMarketplaceManifest(root) as { plugins: Array<{ source: string }> };
    expect(fresh.plugins[0]?.source).toBe("plugins/bravo");
  });

  it("reuses the manifest read by plugin source lookup", () => {
    const home = createTempDir("ht-mkt-source");
    dirs.push(home);
    const root = join(home, ".claude", "plugins", "marketplaces", "acme");
    const manifest = join(root, ".claude-plugin", "marketplace.json");
    mkdirSync(join(manifest, ".."), { recursive: true });
    writeFileSync(manifest, alpha);
    const frozen = new Date("2020-06-01T00:00:00.000Z");
    utimesSync(manifest, frozen, frozen);

    expect(readMarketplacePluginSource(home, "acme", "demo")?.path).toBe("plugins/alpha");
    writeFileSync(manifest, bravo);
    utimesSync(manifest, frozen, frozen);
    expect(readMarketplacePluginSource(home, "acme", "demo")?.path).toBe("plugins/alpha");
    clearMarketplaceManifestCache();
    expect(readMarketplacePluginSource(home, "acme", "demo")?.path).toBe("plugins/bravo");
  });
});
