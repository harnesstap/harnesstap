import { describe, expect, it } from "bun:test";
import {
  ensureClaudeMarketplacesFromConfig,
  extractMarketplaceRepos,
  marketplaceRepoKey,
} from "../../src/services/claude-marketplace-bootstrap.ts";
import type { ClaudeLayerConfig } from "../../src/types.ts";

describe("extractMarketplaceRepos", () => {
  it("returns github repo entries from claude.marketplaces", () => {
    const config: ClaudeLayerConfig = {
      marketplaces: {
        "teads-plugins": {
          source: { source: "github", repo: "outbrain/claude-plugins" },
        },
      },
    };
    expect(extractMarketplaceRepos(config)).toEqual([
      { name: "teads-plugins", repo: "outbrain/claude-plugins" },
    ]);
  });

  it("skips entries without github repo", () => {
    const config: ClaudeLayerConfig = {
      marketplaces: {
        other: { source: { source: "url", url: "https://example.com" } },
      },
    };
    expect(extractMarketplaceRepos(config)).toEqual([]);
  });

  it("dedupes by marketplace name", () => {
    const config: ClaudeLayerConfig = {
      marketplaces: {
        "teads-plugins": {
          source: { source: "github", repo: "outbrain/claude-plugins" },
        },
      },
    };
    expect(extractMarketplaceRepos(config)).toHaveLength(1);
  });
});

describe("marketplaceRepoKey", () => {
  it("normalizes repo slug for comparison", () => {
    expect(marketplaceRepoKey("outbrain/claude-plugins")).toBe(
      "outbrain/claude-plugins",
    );
  });
});

describe("ensureClaudeMarketplacesFromConfig", () => {
  it("adds unconfigured marketplaces via claude plugin marketplace add", () => {
    const calls: string[][] = [];
    const config: ClaudeLayerConfig = {
      marketplaces: {
        "teads-plugins": {
          source: { source: "github", repo: "outbrain/claude-plugins" },
        },
      },
    };
    const added = ensureClaudeMarketplacesFromConfig(config, {
      homeRoot: "/tmp/empty-home-teads-bootstrap-test",
      projectRoot: "/tmp/project",
      runClaudePlugin: (args) => {
        calls.push(args);
        return { exitCode: 0 };
      },
    });
    expect(added).toEqual(["teads-plugins"]);
    expect(calls).toEqual([["marketplace", "add", "outbrain/claude-plugins"]]);
  });
});
