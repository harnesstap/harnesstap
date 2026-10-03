import { describe, it, expect } from "bun:test";
import {
  mergeCatalogPluginsByIdentity,
  parseClaudeMarketplaceManifest,
  parseCursorMarketplaceManifest,
} from "../../src/services/marketplace-catalog-parse.js";

describe("marketplace-catalog-parse", () => {
  it("parses Claude marketplace.json plugins", () => {
    const parsed = parseClaudeMarketplaceManifest({
      name: "demo-market",
      plugins: [
        { name: "demo", version: "2.0.0" },
        { name: "other", source: { sha: "abcd1234ffff" } },
      ],
    });
    expect(parsed.marketplaceName).toBe("demo-market");
    expect(parsed.plugins).toEqual([
      { name: "demo", version: "2.0.0", ref: "demo@demo-market" },
      { name: "other", version: "abcd1234ffff".slice(0, 12), ref: "other@demo-market" },
    ]);
  });

  it("parses marketplace tags, description, and relative source path", () => {
    const parsed = parseClaudeMarketplaceManifest({
      name: "teads-plugins",
      plugins: [
        {
          name: "code-review-workflow",
          source: "./innovation-general/code-and-code-review/code-review-workflow",
          tags: ["code-review", "github"],
        },
        {
          name: "infosec-workflows",
          description: "Security design discussion",
          source: "./teams/infosec/workflows",
          tags: ["security"],
        },
      ],
    });
    expect(parsed.plugins).toEqual([
      {
        name: "code-review-workflow",
        ref: "code-review-workflow@teads-plugins",
        sourcePath: "innovation-general/code-and-code-review/code-review-workflow",
        tags: ["code-review", "github"],
      },
      {
        name: "infosec-workflows",
        ref: "infosec-workflows@teads-plugins",
        description: "Security design discussion",
        sourcePath: "teams/infosec/workflows",
        tags: ["security"],
      },
    ]);
  });

  it("returns empty plugins for invalid Claude shape", () => {
    expect(parseClaudeMarketplaceManifest({ name: "x", plugins: {} }).plugins).toEqual([]);
  });

  it("parses Cursor marketplace plugin path entries", () => {
    const parsed = parseCursorMarketplaceManifest({
      name: "team-marketplace",
      plugins: [{ name: "release-guardian" }, { path: "../plugins/release-guardian" }],
    });
    expect(parsed.marketplaceName).toBe("team-marketplace");
    expect(parsed.plugins.map((p) => p.name)).toEqual([
      "release-guardian",
      "release-guardian",
    ]);
  });

  it("dedups same-named plugins across branches and keeps the higher semver", () => {
    const merged = mergeCatalogPluginsByIdentity([
      { name: "alpha", version: "1.0.0", ref: "alpha@team" },
      { name: "beta", version: "1.0.0", ref: "beta@team" },
      { name: "alpha", version: "2.0.0", ref: "alpha@team", description: "newer" },
    ]);
    expect(merged).toEqual([
      { name: "alpha", version: "2.0.0", ref: "alpha@team", description: "newer" },
      { name: "beta", version: "1.0.0", ref: "beta@team" },
    ]);
  });

  it("unions tags when merging the same plugin across branches", () => {
    const merged = mergeCatalogPluginsByIdentity([
      { name: "alpha", version: "1.0.0", ref: "alpha@team", tags: ["review"] },
      { name: "alpha", version: "2.0.0", ref: "alpha@team", tags: ["slack", "review"] },
    ]);
    expect(merged[0]?.tags).toEqual(["slack", "review"]);
  });
});
