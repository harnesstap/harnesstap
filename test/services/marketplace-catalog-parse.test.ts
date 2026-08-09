import { describe, it, expect } from "bun:test";
import {
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
});
